import { nanoid } from "nanoid";
import {
  onDisconnect,
  ref as dbRef,
  remove,
  serverTimestamp,
  set as dbSet,
  update,
} from "firebase/database";
import { rtdb } from "./firebase";

/**
 * Per-user online presence. Lives at RTDB `users/{uid}/online` with
 * shape `{ lastSeen, currentSessionId, tabs: { <tabId>: true } }`.
 *
 * Multi-tab semantics: each tab registers its own id under `tabs` and
 * uses `onDisconnect()` to remove that key on close. The user is
 * "online" iff at least one tab is registered.
 *
 * Per-tab `currentSessionId` is set when the tab joins or starts a
 * session and cleared on leave. The buddy invite endpoint reads this
 * to auto-decline invites with a "busy" reply when a peer is already
 * mid-session.
 *
 * Lifecycle: caller invokes `attachGlobalPresence(uid)` on auth login,
 * `detachGlobalPresence()` on logout. Idempotent on re-attach.
 */

interface PresenceHandle {
  uid: string;
  tabId: string;
  detached: boolean;
}

let handle: PresenceHandle | null = null;

export function attachGlobalPresence(uid: string): void {
  // Re-attach with same uid is a no-op so a re-render doesn't duplicate.
  if (handle && handle.uid === uid && !handle.detached) return;
  if (handle) detachGlobalPresence();

  const tabId = nanoid(8);
  const onlineRef = dbRef(rtdb, `users/${uid}/online`);
  const tabRef = dbRef(rtdb, `users/${uid}/online/tabs/${tabId}`);

  // Disconnect handler runs server-side when the socket dies — covers
  // tab close, lost network, browser crash. Without this, dead tabs
  // leave stale `tabs` entries that make a user look "online forever."
  void onDisconnect(tabRef).remove();

  // Initial write. `tabs/{tabId} = true` plus a fresh lastSeen.
  // currentSessionId is null until the tab actually joins a session
  // (see updateCurrentSession below).
  void dbSet(onlineRef, {
    v: 1,
    lastSeen: serverTimestamp(),
    currentSessionId: null,
    tabs: { [tabId]: true },
  }).catch(() => {
    // First write may race with another tab's init — patch our tab in
    // afterward. Rules allow uid-only writes so this is safe.
    void update(onlineRef, {
      [`tabs/${tabId}`]: true,
      lastSeen: serverTimestamp(),
    });
  });

  handle = { uid, tabId, detached: false };
}

export function detachGlobalPresence(): void {
  if (!handle || handle.detached) return;
  const { uid, tabId } = handle;
  handle.detached = true;
  // Best-effort sync removal. The `onDisconnect` handler is the
  // backstop if this fails (e.g. user signed out via another tab).
  void remove(dbRef(rtdb, `users/${uid}/online/tabs/${tabId}`));
  handle = null;
}

/**
 * Update the current-session field. Pass null on session leave. Caller
 * is the collab slice — wire from startSession/joinSession (set) and
 * leaveSession/endSession (clear). Multiple tabs of the same user
 * sharing a session is rare in practice; whoever wrote last wins,
 * which is fine because the busy-check is "is the user in ANY OTHER
 * session," not which specific tab.
 */
export function updateCurrentSession(sessionId: string | null): void {
  if (!handle || handle.detached) return;
  const { uid } = handle;
  void update(dbRef(rtdb, `users/${uid}/online`), {
    currentSessionId: sessionId,
    lastSeen: serverTimestamp(),
  });
}
