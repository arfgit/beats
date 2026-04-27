import {
  BUDDY_PROTOCOL_VERSION,
  INVITE_TTL_MS,
  type IncomingInvite,
  type InviteDeclineEvent,
  type Project,
  type SessionMeta,
  type SessionParticipant,
  type UserOnlineState,
} from "@beats/shared";
import { db, rtdb } from "./firebase-admin.js";
import { areBuddies } from "./buddy-service.js";

interface SendInviteResult {
  inviteId: string;
}

/**
 * Errors thrown by the service. The route layer translates these into
 * the appropriate HTTP status — keeping the throw-class enum here so
 * the service stays framework-agnostic and unit-testable without
 * Express in scope.
 */
type ServiceErrCode =
  | "NOT_BUDDIES"
  | "SESSION_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "NOT_IN_SESSION"
  | "RECIPIENT_BUSY"
  | "RECIPIENT_OFFLINE";

function svcErr(
  code: ServiceErrCode,
  msg: string,
): Error & { code: ServiceErrCode } {
  const err = new Error(msg) as Error & { code: ServiceErrCode };
  err.code = code;
  return err;
}

async function readSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  const snap = await rtdb.ref(`sessions/${sessionId}/meta`).get();
  if (!snap.exists()) return null;
  return snap.val() as SessionMeta;
}

async function readSessionParticipants(
  sessionId: string,
): Promise<Record<string, SessionParticipant>> {
  const snap = await rtdb.ref(`sessions/${sessionId}/participants`).get();
  if (!snap.exists()) return {};
  return snap.val() as Record<string, SessionParticipant>;
}

async function readUserOnline(uid: string): Promise<UserOnlineState | null> {
  const snap = await rtdb.ref(`users/${uid}/online`).get();
  if (!snap.exists()) return null;
  return snap.val() as UserOnlineState;
}

async function readProject(projectId: string): Promise<Project | null> {
  const snap = await db.collection("projects").doc(projectId).get();
  if (!snap.exists) return null;
  return snap.data() as Project;
}

interface UserDisplayInfo {
  displayName: string;
  photoUrl: string | null;
}

async function readDisplayInfo(uid: string): Promise<UserDisplayInfo> {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.exists
    ? (snap.data() as { displayName?: string; photoUrl?: string | null })
    : null;
  return {
    displayName: data?.displayName ?? `peer-${uid.slice(0, 6)}`,
    photoUrl: data?.photoUrl ?? null,
  };
}

/**
 * Resolve the user's "is online + busy elsewhere" state. Returns:
 *   - "available" when online with no current session, or in THIS session
 *   - "busy" when online but in a DIFFERENT session
 *   - "offline" when no online doc exists or no tabs are open
 *
 * Multi-tab semantics: `tabs` is an object keyed by per-tab id. A user
 * is online iff at least one tab is registered (onDisconnect drops the
 * key on close). currentSessionId is set by whichever tab is hosting
 * a session — only one at a time per user.
 */
function classifyOnline(
  state: UserOnlineState | null,
  inviteSessionId: string,
): "available" | "busy" | "offline" {
  if (!state) return "offline";
  const tabCount = state.tabs ? Object.keys(state.tabs).length : 0;
  if (tabCount === 0) return "offline";
  const current = state.currentSessionId;
  if (current && current !== inviteSessionId) return "busy";
  return "available";
}

/**
 * Send an invite. Validates: sender is a session participant, sender
 * and recipient are buddies, recipient isn't busy in another session.
 * Writes the invite to RTDB at `users/{toUid}/incomingInvites/{id}`
 * with a 5-minute expiresAt. Returns the inviteId so the sender's UI
 * can correlate later events (decline, busy).
 */
export async function sendInvite(args: {
  fromUid: string;
  toUid: string;
  sessionId: string;
  inviteId: string;
}): Promise<SendInviteResult> {
  const { fromUid, toUid, sessionId, inviteId } = args;

  const meta = await readSessionMeta(sessionId);
  if (!meta) throw svcErr("SESSION_NOT_FOUND", "session not found");

  const participants = await readSessionParticipants(sessionId);
  if (!participants[fromUid]) {
    throw svcErr("NOT_IN_SESSION", "sender is not a session participant");
  }

  const isBuddy = await areBuddies(fromUid, toUid);
  if (!isBuddy) throw svcErr("NOT_BUDDIES", "recipient is not a buddy");

  const project = await readProject(meta.projectId);
  if (!project) throw svcErr("PROJECT_NOT_FOUND", "project missing");

  const onlineState = await readUserOnline(toUid);
  const status = classifyOnline(onlineState, sessionId);
  if (status === "busy") {
    throw svcErr("RECIPIENT_BUSY", "recipient is in another session");
  }
  if (status === "offline") {
    // Still allow — the invite TTL will expire if they don't sign in
    // within 5 minutes. Better than blocking outright in case the
    // recipient is mid-reconnect.
  }

  const fromInfo = await readDisplayInfo(fromUid);
  const now = Date.now();
  const invite: IncomingInvite = {
    v: BUDDY_PROTOCOL_VERSION,
    id: inviteId,
    sessionId,
    projectId: meta.projectId,
    projectTitle: project.title,
    fromUid,
    fromDisplayName: fromInfo.displayName,
    fromPhotoUrl: fromInfo.photoUrl,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  };

  await rtdb.ref(`users/${toUid}/incomingInvites/${inviteId}`).set(invite);
  return { inviteId };
}

/**
 * Recipient declines an invite. Removes the invite node and writes a
 * decline event to the sender's inviteEvents so their UI can toast
 * "Bob declined". Idempotent — silently no-ops if the invite is gone.
 */
export async function declineInvite(args: {
  callerUid: string;
  inviteId: string;
}): Promise<void> {
  const { callerUid, inviteId } = args;
  const inviteRef = rtdb.ref(`users/${callerUid}/incomingInvites/${inviteId}`);
  const snap = await inviteRef.get();
  if (!snap.exists()) return;
  const invite = snap.val() as IncomingInvite;

  await inviteRef.remove();

  const callerInfo = await readDisplayInfo(callerUid);
  const event: InviteDeclineEvent = {
    v: BUDDY_PROTOCOL_VERSION,
    id: inviteId,
    type: "invite-declined",
    inviteId,
    byUid: callerUid,
    byDisplayName: callerInfo.displayName,
    createdAt: Date.now(),
  };
  await rtdb
    .ref(`users/${invite.fromUid}/inviteEvents/${inviteId}-declined`)
    .set(event)
    .catch(() => undefined);
}
