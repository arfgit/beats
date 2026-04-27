import { randomBytes } from "node:crypto";
import {
  BUDDY_CODE_ALPHABET,
  BUDDY_CODE_BODY_LENGTH,
  BUDDY_CODE_PREFIX,
  BUDDY_PROTOCOL_VERSION,
  type BuddyConnection,
  type BuddyRequest,
  type InviteDeclineEvent,
} from "@beats/shared";
import { db, rtdb } from "./firebase-admin.js";

/**
 * Generate a fresh buddy code. Crockford-ish base32 (no I/L/O/U/0/1)
 * keeps codes legible when shared verbally. Server-only — clients
 * never call this directly.
 */
function randomBuddyCode(): string {
  const bytes = randomBytes(BUDDY_CODE_BODY_LENGTH);
  let body = "";
  for (let i = 0; i < BUDDY_CODE_BODY_LENGTH; i++) {
    body += BUDDY_CODE_ALPHABET[bytes[i]! % BUDDY_CODE_ALPHABET.length];
  }
  return `${BUDDY_CODE_PREFIX}${body}`;
}

/**
 * Find an unused code. The keyspace is large enough that retries are
 * rare, but we cap at 5 attempts so a saturated namespace surfaces as
 * a clean error instead of an infinite loop.
 */
async function findUnusedCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomBuddyCode();
    const snap = await db.collection("buddyCodes").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new Error("buddy code namespace saturated — could not allocate");
}

/**
 * Look up the user's existing code or generate a new one. Caller is
 * responsible for auth — we trust the uid argument. Idempotent: a
 * second call returns the existing code.
 */
export async function ensureBuddyCode(uid: string): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();
  const existingCode = (existing.data() as { buddyCode?: string } | undefined)
    ?.buddyCode;
  if (existingCode) return existingCode;

  const code = await findUnusedCode();
  await db.runTransaction(async (tx) => {
    const codeRef = db.collection("buddyCodes").doc(code);
    tx.set(codeRef, { uid, createdAt: Date.now() });
    tx.set(userRef, { buddyCode: code }, { merge: true });
  });
  return code;
}

/**
 * Resolve a code to a uid. Returns null when the code is unknown so the
 * route can return a clean 404 rather than throwing.
 */
export async function lookupBuddyCode(code: string): Promise<string | null> {
  const snap = await db.collection("buddyCodes").doc(code).get();
  if (!snap.exists) return null;
  const data = snap.data() as { uid?: string };
  return data.uid ?? null;
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
 * Create a pending request from `fromUid` to `toUid`. Mirrored on both
 * users' subcollections with the same id so accept/decline only need
 * the request id. Idempotent on existing pending or already-buddies.
 */
export async function createBuddyRequest(
  fromUid: string,
  toUid: string,
  requestId: string,
): Promise<BuddyRequest> {
  if (fromUid === toUid) {
    const err = new Error("cannot buddy yourself") as Error & { code: string };
    err.code = "SELF_REFERENCE";
    throw err;
  }

  // Block if already buddies — no point in queueing a request.
  const existingBuddy = await db
    .collection("users")
    .doc(fromUid)
    .collection("buddies")
    .doc(toUid)
    .get();
  if (existingBuddy.exists) {
    const err = new Error("already buddies") as Error & { code: string };
    err.code = "ALREADY_BUDDIES";
    throw err;
  }

  const fromInfo = await readDisplayInfo(fromUid);

  const now = Date.now();
  const fromRef = db
    .collection("users")
    .doc(fromUid)
    .collection("buddyRequests")
    .doc(requestId);
  const toRef = db
    .collection("users")
    .doc(toUid)
    .collection("buddyRequests")
    .doc(requestId);

  const outgoing: BuddyRequest = {
    v: BUDDY_PROTOCOL_VERSION,
    id: requestId,
    fromUid,
    fromDisplayName: fromInfo.displayName,
    toUid,
    direction: "outgoing",
    createdAt: now,
  };
  const incoming: BuddyRequest = {
    ...outgoing,
    direction: "incoming",
  };

  const batch = db.batch();
  batch.set(fromRef, outgoing);
  batch.set(toRef, incoming);
  await batch.commit();
  return incoming;
}

/**
 * Promote a pending request to a full bidirectional buddy edge.
 * Caller must be the recipient (`toUid`). Reads both request docs and
 * tolerates a missing one — partial failures from a prior attempt
 * shouldn't block accept the second time around.
 */
export async function acceptBuddyRequest(
  callerUid: string,
  requestId: string,
): Promise<BuddyConnection> {
  const callerReqRef = db
    .collection("users")
    .doc(callerUid)
    .collection("buddyRequests")
    .doc(requestId);
  const callerReqSnap = await callerReqRef.get();
  if (!callerReqSnap.exists) {
    const err = new Error("request not found") as Error & { code: string };
    err.code = "NOT_FOUND";
    throw err;
  }
  const callerReq = callerReqSnap.data() as BuddyRequest;
  if (callerReq.toUid !== callerUid || callerReq.direction !== "incoming") {
    const err = new Error("only the recipient can accept") as Error & {
      code: string;
    };
    err.code = "FORBIDDEN";
    throw err;
  }

  const otherUid = callerReq.fromUid;
  const otherReqRef = db
    .collection("users")
    .doc(otherUid)
    .collection("buddyRequests")
    .doc(requestId);

  const [callerInfo, otherInfo] = await Promise.all([
    readDisplayInfo(callerUid),
    readDisplayInfo(otherUid),
  ]);

  const now = Date.now();
  const callerBuddyRef = db
    .collection("users")
    .doc(callerUid)
    .collection("buddies")
    .doc(otherUid);
  const otherBuddyRef = db
    .collection("users")
    .doc(otherUid)
    .collection("buddies")
    .doc(callerUid);

  const callerSidesEdge: BuddyConnection = {
    v: BUDDY_PROTOCOL_VERSION,
    uid: otherUid,
    displayName: otherInfo.displayName,
    photoUrl: otherInfo.photoUrl,
    addedAt: now,
  };
  const otherSidesEdge: BuddyConnection = {
    v: BUDDY_PROTOCOL_VERSION,
    uid: callerUid,
    displayName: callerInfo.displayName,
    photoUrl: callerInfo.photoUrl,
    addedAt: now,
  };

  const batch = db.batch();
  batch.set(callerBuddyRef, callerSidesEdge);
  batch.set(otherBuddyRef, otherSidesEdge);
  batch.delete(callerReqRef);
  batch.delete(otherReqRef);
  await batch.commit();

  // Notify the requester via RTDB so their UI updates without a poll.
  const event: InviteDeclineEvent = {
    v: BUDDY_PROTOCOL_VERSION,
    id: requestId,
    type: "buddy-accepted",
    byUid: callerUid,
    byDisplayName: callerInfo.displayName,
    createdAt: now,
  };
  await rtdb
    .ref(`users/${otherUid}/inviteEvents/${requestId}-accepted`)
    .set(event)
    .catch(() => undefined);

  return callerSidesEdge;
}

/** Drop both sides of a pending request. Idempotent on missing. */
export async function declineBuddyRequest(
  callerUid: string,
  requestId: string,
): Promise<void> {
  const callerReqRef = db
    .collection("users")
    .doc(callerUid)
    .collection("buddyRequests")
    .doc(requestId);
  const callerReqSnap = await callerReqRef.get();
  if (!callerReqSnap.exists) return; // idempotent — nothing to do
  const callerReq = callerReqSnap.data() as BuddyRequest;
  const otherUid =
    callerReq.fromUid === callerUid ? callerReq.toUid : callerReq.fromUid;
  const otherReqRef = db
    .collection("users")
    .doc(otherUid)
    .collection("buddyRequests")
    .doc(requestId);

  const batch = db.batch();
  batch.delete(callerReqRef);
  batch.delete(otherReqRef);
  await batch.commit();
}

/** Drop both sides of an existing buddy edge. */
export async function removeBuddyConnection(
  callerUid: string,
  otherUid: string,
): Promise<void> {
  const callerEdgeRef = db
    .collection("users")
    .doc(callerUid)
    .collection("buddies")
    .doc(otherUid);
  const otherEdgeRef = db
    .collection("users")
    .doc(otherUid)
    .collection("buddies")
    .doc(callerUid);

  const batch = db.batch();
  batch.delete(callerEdgeRef);
  batch.delete(otherEdgeRef);
  await batch.commit();
}

/** Cheap predicate for the invite endpoint to gate on buddy edge. */
export async function areBuddies(a: string, b: string): Promise<boolean> {
  const snap = await db
    .collection("users")
    .doc(a)
    .collection("buddies")
    .doc(b)
    .get();
  return snap.exists;
}
