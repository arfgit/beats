import type { StateCreator } from "zustand";
import {
  collection,
  doc,
  onSnapshot,
  type Unsubscribe as FirestoreUnsub,
} from "firebase/firestore";
import {
  off,
  onValue,
  ref as dbRef,
  remove as dbRemove,
  type DataSnapshot,
} from "firebase/database";
import {
  type BuddyConnection,
  type BuddyRequest,
  type IncomingInvite,
  type InviteDeclineEvent,
} from "@beats/shared";
import { db, rtdb } from "@/lib/firebase";
import { api, ApiCallError } from "@/lib/api";
import {
  attachGlobalPresence,
  detachGlobalPresence,
} from "@/lib/global-presence";
import type { BeatsStore } from "./useBeatsStore";

/**
 * Buddy state lives next to collab/auth in the same monolithic store.
 * Listeners attach when auth flips to "authed" and detach on sign out
 * (driven from `useBeatsStore.ts` mount glue).
 */
export interface BuddySlice {
  buddy: {
    myCode: string | null;
    buddies: Record<string, BuddyConnection>;
    /** Pending requests in either direction; UI splits by `direction`. */
    requests: Record<string, BuddyRequest>;
    incomingInvites: Record<string, IncomingInvite>;
    /** Set of buddy uids that have at least one open tab right now. */
    onlineUids: Record<string, true>;
    /**
     * Set by `acceptIncomingInvite` so a small bridge component can
     * call useNavigate without coupling the slice to react-router.
     */
    pendingNavigation: string | null;
    /** RTDB / Firestore listener teardowns, run on detach. */
    detach: Array<() => void>;
  };
  loadBuddyCode: () => Promise<void>;
  submitBuddyCode: (code: string) => Promise<boolean>;
  acceptBuddyRequest: (requestId: string) => Promise<void>;
  declineBuddyRequest: (requestId: string) => Promise<void>;
  removeBuddy: (uid: string) => Promise<void>;
  sendInvite: (toUid: string, sessionId: string) => Promise<boolean>;
  acceptIncomingInvite: (invite: IncomingInvite) => Promise<void>;
  declineIncomingInvite: (inviteId: string) => Promise<void>;
  attachBuddyListeners: (uid: string) => void;
  detachBuddyListeners: () => void;
  consumePendingNavigation: () => string | null;
}

function freshBuddy(): BuddySlice["buddy"] {
  return {
    myCode: null,
    buddies: {},
    requests: {},
    incomingInvites: {},
    onlineUids: {},
    pendingNavigation: null,
    detach: [],
  };
}

/**
 * Per-buddy online listener teardowns. Lives in module scope rather
 * than inside the buddy state so we don't have to attach `onValue`
 * inside a Zustand `set` reducer. RTDB delivers cached data
 * synchronously to the freshly-attached handler, which would call
 * `set` again, nesting one set inside another — a known footgun in
 * Zustand + React 18 useSyncExternalStore that surfaces as React
 * error #185 in production builds.
 */
let onlineDetachByUid = new Map<string, () => void>();

/**
 * Event IDs we've already toasted. Belt-and-suspenders against
 * RTDB optimistic-write loops: if `dbRemove` is denied by rules,
 * Firebase reverts the local cache and re-fires onValue with the
 * same data, which would re-toast forever. Tracking toasted IDs
 * keeps the toast count at one per event no matter how many times
 * the listener re-fires.
 */
let toastedEventIds = new Set<string>();

export const createBuddySlice: StateCreator<BeatsStore, [], [], BuddySlice> = (
  set,
  get,
) => ({
  buddy: freshBuddy(),

  loadBuddyCode: async () => {
    try {
      const result = await api.get<{ code: string }>("/me/buddy-code");
      set((s) => ({ buddy: { ...s.buddy, myCode: result.code } }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[buddy] loadBuddyCode failed", err);
    }
  },

  submitBuddyCode: async (code) => {
    try {
      await api.post("/buddies/connect", { code });
      get().pushToast("success", "buddy request sent");
      return true;
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "request failed";
      get().pushToast("error", message);
      return false;
    }
  },

  acceptBuddyRequest: async (requestId) => {
    try {
      await api.post(`/buddies/requests/${requestId}/accept`, {});
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "accept failed";
      get().pushToast("error", message);
    }
  },

  declineBuddyRequest: async (requestId) => {
    try {
      await api.post(`/buddies/requests/${requestId}/decline`, {});
    } catch {
      // Idempotent on the server; ignore.
    }
  },

  removeBuddy: async (uid) => {
    try {
      await api.delete(`/buddies/${uid}`);
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "remove failed";
      get().pushToast("error", message);
    }
  },

  sendInvite: async (toUid, sessionId) => {
    try {
      await api.post("/invites", { toUid, sessionId });
      get().pushToast("success", "invite sent");
      return true;
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "invite failed";
      get().pushToast(
        err instanceof ApiCallError && err.apiError.code === "CONFLICT"
          ? "warn"
          : "error",
        message,
      );
      return false;
    }
  },

  acceptIncomingInvite: async (invite) => {
    // Drop the RTDB invite first so other tabs (or our own re-render)
    // don't double-process. Server doesn't need to know about accept;
    // joinSession handles the participant write.
    const myUid = get().auth.user?.id;
    if (myUid) {
      void dbRemove(
        dbRef(rtdb, `users/${myUid}/incomingInvites/${invite.id}`),
      ).catch(() => undefined);
    }
    const ok = await get().joinSession(invite.sessionId);
    if (!ok) {
      get().pushToast("error", "couldn't join — link may have expired");
      return;
    }
    set((s) => ({
      buddy: {
        ...s.buddy,
        pendingNavigation: `/studio/${invite.projectId}`,
      },
    }));
  },

  declineIncomingInvite: async (inviteId) => {
    const myUid = get().auth.user?.id;
    // Optimistic local clear so the toast disappears immediately even
    // if the server call is slow — RTDB delete is the source of truth
    // but the user shouldn't see a sticky toast while awaiting it.
    if (myUid) {
      void dbRemove(
        dbRef(rtdb, `users/${myUid}/incomingInvites/${inviteId}`),
      ).catch(() => undefined);
    }
    try {
      await api.post(`/invites/${inviteId}/decline`, {});
    } catch {
      // Server records the decline event; if it fails the sender just
      // doesn't get the "Bob declined" toast. Don't alarm the user.
    }
  },

  attachBuddyListeners: (uid) => {
    // Idempotent: detach previous listeners before attaching new.
    get().detachBuddyListeners();
    attachGlobalPresence(uid);

    const detach: Array<() => void> = [];

    // 1. Buddies subcollection. Two separate phases avoid nesting a
    //    `set` inside another `set` reducer:
    //    (a) commit the new buddies map + reconciled onlineUids in
    //        ONE `set` call.
    //    (b) AFTER the set returns, attach/detach the per-buddy RTDB
    //        online listeners. RTDB fires the handler synchronously
    //        with cached data; if we did this inside the reducer that
    //        callback would call `set` while the outer set is still
    //        running, which trips React #185 in production builds.
    const buddiesUnsub: FirestoreUnsub = onSnapshot(
      collection(db, `users/${uid}/buddies`),
      (snap) => {
        const next: Record<string, BuddyConnection> = {};
        const seenUids = new Set<string>();
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as BuddyConnection;
          next[docSnap.id] = data;
          seenUids.add(docSnap.id);
        }
        // (a) commit buddies + filtered onlineUids
        set((s) => {
          const filtered: Record<string, true> = {};
          for (const u of seenUids) {
            if (s.buddy.onlineUids[u]) filtered[u] = true;
          }
          return {
            buddy: { ...s.buddy, buddies: next, onlineUids: filtered },
          };
        });
        // (b) reconcile per-buddy listeners outside the reducer
        for (const [u, detachFn] of onlineDetachByUid) {
          if (!seenUids.has(u)) {
            try {
              detachFn();
            } catch {
              // ignore
            }
            onlineDetachByUid.delete(u);
          }
        }
        for (const otherUid of seenUids) {
          if (onlineDetachByUid.has(otherUid)) continue;
          const onlineRef = dbRef(rtdb, `users/${otherUid}/online`);
          const handler = (online: DataSnapshot) => {
            const val = online.val() as { tabs?: Record<string, true> } | null;
            const isOnline =
              !!val && !!val.tabs && Object.keys(val.tabs).length > 0;
            set((inner) => {
              const cur = inner.buddy.onlineUids[otherUid] ? true : false;
              if (cur === isOnline) return inner; // <-- short-circuit no-op writes
              const onlines = { ...inner.buddy.onlineUids };
              if (isOnline) onlines[otherUid] = true;
              else delete onlines[otherUid];
              return { buddy: { ...inner.buddy, onlineUids: onlines } };
            });
          };
          onValue(onlineRef, handler);
          onlineDetachByUid.set(otherUid, () =>
            off(onlineRef, "value", handler),
          );
        }
      },
    );
    detach.push(() => buddiesUnsub());

    // 2. Requests subcollection.
    const requestsUnsub: FirestoreUnsub = onSnapshot(
      collection(db, `users/${uid}/buddyRequests`),
      (snap) => {
        const next: Record<string, BuddyRequest> = {};
        for (const docSnap of snap.docs) {
          next[docSnap.id] = docSnap.data() as BuddyRequest;
        }
        set((s) => ({ buddy: { ...s.buddy, requests: next } }));
      },
    );
    detach.push(() => requestsUnsub());

    // 3. Incoming invites — RTDB live updates.
    const invitesRef = dbRef(rtdb, `users/${uid}/incomingInvites`);
    const invitesHandler = (snap: DataSnapshot) => {
      const raw = (snap.val() as Record<string, IncomingInvite> | null) ?? {};
      const now = Date.now();
      const next: Record<string, IncomingInvite> = {};
      for (const [id, invite] of Object.entries(raw)) {
        if (invite.expiresAt > now) next[id] = invite;
      }
      set((s) => ({ buddy: { ...s.buddy, incomingInvites: next } }));
    };
    onValue(invitesRef, invitesHandler);
    detach.push(() => off(invitesRef, "value", invitesHandler));

    // 4. Sender-side decline / busy / accepted events. Two-pronged
    //    defense against RTDB optimistic-write loops: a dedup Set
    //    here keeps a single toast per eventId regardless of how
    //    many times the listener re-fires for the same data, AND
    //    the rules now permit recipient-deletes so dbRemove actually
    //    succeeds (clearing the event for good).
    const eventsRef = dbRef(rtdb, `users/${uid}/inviteEvents`);
    const eventsHandler = (snap: DataSnapshot) => {
      const raw =
        (snap.val() as Record<string, InviteDeclineEvent> | null) ?? {};
      for (const [eventId, event] of Object.entries(raw)) {
        if (toastedEventIds.has(eventId)) {
          // Already shown — just retry the delete in case rules were
          // previously denying. dbRemove is idempotent on missing.
          void dbRemove(
            dbRef(rtdb, `users/${uid}/inviteEvents/${eventId}`),
          ).catch(() => undefined);
          continue;
        }
        toastedEventIds.add(eventId);
        if (event.type === "invite-declined") {
          get().pushToast("info", `${event.byDisplayName} declined the invite`);
        } else if (event.type === "buddy-accepted") {
          get().pushToast(
            "success",
            `${event.byDisplayName} accepted your buddy request`,
          );
        }
        void dbRemove(
          dbRef(rtdb, `users/${uid}/inviteEvents/${eventId}`),
        ).catch(() => undefined);
      }
    };
    onValue(eventsRef, eventsHandler);
    detach.push(() => off(eventsRef, "value", eventsHandler));

    set((s) => ({ buddy: { ...s.buddy, detach } }));

    // Lazy-load the code so the chip in the header has data on first
    // render. Failure here is non-fatal; UI degrades to "—".
    void get().loadBuddyCode();
  },

  detachBuddyListeners: () => {
    const state = get().buddy;
    for (const fn of state.detach) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    for (const fn of onlineDetachByUid.values()) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    onlineDetachByUid = new Map();
    toastedEventIds = new Set();
    detachGlobalPresence();
    set(() => ({ buddy: freshBuddy() }));
  },

  consumePendingNavigation: () => {
    const next = get().buddy.pendingNavigation;
    if (next === null) return null;
    set((s) => ({ buddy: { ...s.buddy, pendingNavigation: null } }));
    return next;
  },
});
