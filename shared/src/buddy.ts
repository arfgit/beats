/**
 * Wire shapes for the buddy + real-time invite system. Lives next to
 * `collab.ts` because the invite flow ultimately funnels into the
 * existing live-session feature: an accepted invite is just a
 * pre-resolved version of the `?session=<id>` URL flow.
 */

export const BUDDY_PROTOCOL_VERSION = 1;

/**
 * Display format `BX-XXXXX` (5 base32 chars after the prefix). Crockford
 * base32 minus ambiguous chars (no I, L, O, U, 0, 1) gives ~28^5 = 17M
 * codes; collision rate at 1M users is around 3% per generation, which
 * the server's retry loop handles cleanly. Hyphen is purely cosmetic;
 * lookups normalize via `normalizeBuddyCode()` below.
 */
export const BUDDY_CODE_REGEX = /^BX-[A-Z0-9]{5}$/;
export const BUDDY_CODE_PREFIX = "BX-";
export const BUDDY_CODE_BODY_LENGTH = 5;
/** Characters allowed in the body — drops 0/1/I/L/O/U for legibility. */
export const BUDDY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** Strip whitespace + uppercase + ensure the BX- prefix for lookups. */
export function normalizeBuddyCode(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  if (cleaned.startsWith(BUDDY_CODE_PREFIX)) return cleaned;
  return `${BUDDY_CODE_PREFIX}${cleaned}`;
}

/** Invite TTL — five minutes is comfortable for a "live now" call. */
export const INVITE_TTL_MS = 5 * 60 * 1000;

/**
 * One side of a buddy edge — what we store under
 * `users/{uid}/buddies/{otherUid}`. Both sides are written in a batch
 * by the server when an accept lands.
 */
export interface BuddyConnection {
  v: typeof BUDDY_PROTOCOL_VERSION;
  uid: string; // the OTHER user
  displayName: string;
  photoUrl: string | null;
  addedAt: number;
}

/**
 * Pending request (either direction). Stored on both users' subcollections
 * with the same `id` so accept/decline are symmetric. `direction` is
 * always relative to the doc's parent uid: "incoming" for the recipient,
 * "outgoing" for the sender.
 */
export interface BuddyRequest {
  v: typeof BUDDY_PROTOCOL_VERSION;
  id: string;
  fromUid: string;
  fromDisplayName: string;
  toUid: string;
  direction: "incoming" | "outgoing";
  createdAt: number;
}

/**
 * Real-time invite delivered via RTDB at
 * `users/{recipientUid}/incomingInvites/{inviteId}`. Server-only writes.
 * Carries enough metadata for the toast to render without a Firestore
 * round-trip (project title, sender's display info).
 */
export interface IncomingInvite {
  v: typeof BUDDY_PROTOCOL_VERSION;
  id: string;
  sessionId: string;
  projectId: string;
  projectTitle: string;
  fromUid: string;
  fromDisplayName: string;
  fromPhotoUrl: string | null;
  createdAt: number;
  expiresAt: number;
}

/**
 * Sender-side notification fired when the recipient declines an invite.
 * Stored at `users/{senderUid}/inviteEvents/{eventId}`. Client deletes
 * after rendering the toast; this isn't durable history, just signal.
 */
export interface InviteDeclineEvent {
  v: typeof BUDDY_PROTOCOL_VERSION;
  id: string;
  type: "invite-declined" | "invite-busy" | "buddy-accepted";
  inviteId?: string;
  byUid: string;
  byDisplayName: string;
  createdAt: number;
}

/** Per-user online presence node. */
export interface UserOnlineState {
  v: typeof BUDDY_PROTOCOL_VERSION;
  lastSeen: number;
  /** Non-null when the user is in a live session. Drives busy-check. */
  currentSessionId: string | null;
  /** One key per open tab — onDisconnect removes its own entry. */
  tabs: Record<string, true>;
}
