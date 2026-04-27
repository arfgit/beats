import type { StateCreator } from "zustand";
import {
  ref as dbRef,
  off,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  remove as dbRemove,
  update as dbUpdate,
  type DataSnapshot,
} from "firebase/database";
import {
  COLLAB_PROTOCOL_VERSION,
  type EditMessage,
  type EditOp,
  type PresenceState,
  type SessionMeta,
  type SessionParticipant,
  type SessionPermissions,
} from "@beats/shared";
import { rtdb } from "@/lib/firebase";
import { api } from "@/lib/api";
import { updateCurrentSession } from "@/lib/global-presence";
import {
  forgetActiveSession,
  rememberActiveSession,
} from "@/lib/session-memory";
import {
  clearPresence,
  pickPeerColor,
  subscribeToPresence,
  writePresence,
  type PresenceState as FirestorePresenceState,
} from "@/lib/presence";
import type { BeatsStore } from "./useBeatsStore";

/**
 * Two-channel collab:
 *  - **Firestore presence** (legacy, stays the default): cheap "are you
 *    here?" signal. Used when the user opens a project but hasn't
 *    started a live session.
 *  - **RTDB session**: real-time edits, presence, snapshot. Activated
 *    when the user starts or joins a session.
 *
 * The two channels never run together — `startSession` suspends the
 * Firestore presence, `leaveSession` re-arms it. State lives under
 * `collab.session` so the legacy fields stay backwards-compatible.
 */

export interface CollabSlice {
  collab: {
    // --- Firestore presence (legacy) ---
    peers: FirestorePresenceState[];
    focused: {
      cellId: string | null;
      trackId: string | null;
      step: number | null;
    };
    unsubscribe: (() => void) | null;
    heartbeat: ReturnType<typeof setInterval> | null;
    activeProjectId: string | null;
    // --- RTDB session (live edits + presence) ---
    session: {
      id: string | null;
      meta: SessionMeta | null;
      participants: Record<string, SessionParticipant>;
      presence: Record<string, PresenceState>;
      role: SessionParticipant["role"] | null;
      /**
       * Set to true while a remote edit is being applied locally — the
       * patternSlice / matrixSlice actions check this and skip the
       * emit-back step so we don't echo the same op forever.
       */
      applyingRemote: boolean;
      /** RTDB listener teardown closures, invoked on leave. */
      detach: Array<() => void>;
    };
  };
  startCollab: (projectId: string) => void;
  stopCollab: () => void;
  focusCell: (
    cellId: string | null,
    trackId: string | null,
    step: number | null,
  ) => void;
  // --- session lifecycle ---
  startSession: (projectId: string) => Promise<string | null>;
  joinSession: (sessionId: string) => Promise<boolean>;
  leaveSession: () => Promise<void>;
  endSession: () => Promise<void>;
  setSessionPermissions: (
    next: Partial<SessionPermissions>,
  ) => Promise<boolean>;
  // --- broadcast ---
  emitEdit: (op: EditOp) => void;
  emitPresence: (
    cursor: { x: number; y: number } | null,
    focus: { cellId?: string; trackId?: string; step?: number } | null,
  ) => void;
}

const HEARTBEAT_MS = 3000;

function freshSession(): CollabSlice["collab"]["session"] {
  return {
    id: null,
    meta: null,
    participants: {},
    presence: {},
    role: null,
    applyingRemote: false,
    detach: [],
  };
}

export const createCollabSlice: StateCreator<
  BeatsStore,
  [],
  [],
  CollabSlice
> = (set, get) => ({
  collab: {
    peers: [],
    focused: { cellId: null, trackId: null, step: null },
    unsubscribe: null,
    heartbeat: null,
    activeProjectId: null,
    session: freshSession(),
  },

  startCollab: (projectId) => {
    const user = get().auth.user;
    if (!user) return;
    // If we're in a live session, the session channel owns presence —
    // don't double-broadcast via the Firestore path.
    if (get().collab.session.id) return;
    get().stopCollab();

    const pushSelf = () => {
      const focused = get().collab.focused;
      const cellId = focused.cellId ?? get().selectedCellId;
      void writePresence(projectId, {
        uid: user.id,
        displayName: user.displayName,
        color: pickPeerColor(user.id),
        focusedCellId: cellId,
        focusedTrackId: focused.trackId,
        focusedStep: focused.step,
        updatedAt: Date.now(),
      });
    };

    const unsub = subscribeToPresence(projectId, user.id, (peers) => {
      set((s) => ({ collab: { ...s.collab, peers } }));
    });

    pushSelf();
    const heartbeat = setInterval(pushSelf, HEARTBEAT_MS);

    set((s) => ({
      collab: {
        ...s.collab,
        unsubscribe: unsub,
        heartbeat,
        activeProjectId: projectId,
      },
    }));
  },

  stopCollab: () => {
    const user = get().auth.user;
    const state = get().collab;
    state.unsubscribe?.();
    if (state.heartbeat) clearInterval(state.heartbeat);
    if (user && state.activeProjectId) {
      void clearPresence(state.activeProjectId, user.id);
    }
    set((s) => ({
      collab: {
        ...s.collab,
        peers: [],
        unsubscribe: null,
        heartbeat: null,
        activeProjectId: null,
      },
    }));
  },

  focusCell: (cellId, trackId, step) => {
    set((s) => ({
      collab: { ...s.collab, focused: { cellId, trackId, step } },
    }));
    // When in a live session, focus changes broadcast immediately —
    // peers expect "I'm now hovering this step" to land within one
    // frame, not on the next 100ms tick.
    if (get().collab.session.id) {
      get().emitPresence(null, {
        cellId: cellId ?? undefined,
        trackId: trackId ?? undefined,
        step: step ?? undefined,
      });
    }
  },

  // --- Session lifecycle ---

  startSession: async (projectId) => {
    const user = get().auth.user;
    if (!user) return null;
    try {
      const result = await api.post<{
        sessionId: string;
        meta: SessionMeta;
        participant: SessionParticipant;
      }>("/sessions", { projectId });
      // Suspend Firestore presence — RTDB takes over.
      get().stopCollab();
      // Suspend the project's Firestore onSnapshot listener too — its
      // remote-apply branch would echo every PATCH back through the
      // applyingRemote codepath while RTDB is also pushing those edits,
      // causing double-application. We re-subscribe on leave.
      get().project.unsubscribeRemote?.();
      attachSessionListeners(result.sessionId, set, get);
      set((s) => ({
        collab: {
          ...s.collab,
          session: {
            ...freshSession(),
            id: result.sessionId,
            meta: result.meta,
            participants: { [user.id]: result.participant },
            role: result.participant.role,
            detach: s.collab.session.detach, // overwritten by attachSessionListeners
          },
        },
      }));
      // Tell our global-presence node we're now in this session so
      // the buddy invite endpoint can reject "Bob is busy" cases.
      updateCurrentSession(result.sessionId);
      // Persist the session id keyed by projectId so a tab refresh
      // can silently re-attach instead of dropping the host out of
      // their own session.
      rememberActiveSession(projectId, result.sessionId);
      return result.sessionId;
    } catch (err) {
      console.error("[collab] startSession failed", err);
      return null;
    }
  },

  joinSession: async (sessionId) => {
    const user = get().auth.user;
    if (!user) return false;
    try {
      const result = await api.post<{
        meta: SessionMeta;
        participants: Record<string, SessionParticipant>;
        state: unknown;
        participant: SessionParticipant;
      }>(`/sessions/${sessionId}/join`, {});
      get().stopCollab();
      get().project.unsubscribeRemote?.();
      // Apply the canonical state from the session BEFORE we start
      // listening for edits, otherwise an edit that lands during the
      // round trip would be applied to a stale base.
      if (result.state) {
        const projectId = result.meta.projectId;
        applyRemoteSnapshot(set, get, projectId, result.state);
      }
      attachSessionListeners(sessionId, set, get);
      set((s) => ({
        collab: {
          ...s.collab,
          session: {
            ...freshSession(),
            id: sessionId,
            meta: result.meta,
            participants: result.participants,
            role: result.participant.role,
            detach: s.collab.session.detach,
          },
        },
      }));
      updateCurrentSession(sessionId);
      rememberActiveSession(result.meta.projectId, sessionId);
      return true;
    } catch (err) {
      console.error("[collab] joinSession failed", err);
      return false;
    }
  },

  leaveSession: async () => {
    const sessionId = get().collab.session.id;
    if (!sessionId) return;
    const projectId = get().collab.session.meta?.projectId;
    if (projectId) forgetActiveSession(projectId);
    detachSessionListeners(get);
    try {
      await api.post(`/sessions/${sessionId}/leave`, {});
    } catch (err) {
      console.warn("[collab] leaveSession server call failed", err);
    }
    set((s) => ({ collab: { ...s.collab, session: freshSession() } }));
    updateCurrentSession(null);
    // Re-arm the legacy Firestore presence on the project we were in,
    // and re-subscribe to the project's onSnapshot listener so remote
    // edits made outside the session (e.g. another tab) start landing
    // again.
    const currentProjectId = get().project.current?.id;
    if (currentProjectId) {
      void get().loadProject(currentProjectId);
      get().startCollab(currentProjectId);
    }
  },

  endSession: async () => {
    const sessionId = get().collab.session.id;
    if (!sessionId) return;
    const projectId = get().collab.session.meta?.projectId;
    if (projectId) forgetActiveSession(projectId);
    detachSessionListeners(get);
    try {
      await api.delete(`/sessions/${sessionId}`);
    } catch (err) {
      console.warn("[collab] endSession server call failed", err);
    }
    set((s) => ({ collab: { ...s.collab, session: freshSession() } }));
    updateCurrentSession(null);
    const currentProjectId = get().project.current?.id;
    if (currentProjectId) get().startCollab(currentProjectId);
  },

  setSessionPermissions: async (nextPermissions) => {
    const session = get().collab.session;
    const sessionId = session.id;
    const myUid = get().auth.user?.id ?? null;
    if (!sessionId || !session.meta) return false;
    if (myUid !== session.meta.ownerUid) return false;
    try {
      await api.patch(`/sessions/${sessionId}/permissions`, nextPermissions);
      // metaHandler picks up the RTDB change and refreshes local state.
      return true;
    } catch (err) {
      console.warn("[collab] setSessionPermissions failed", err);
      get().pushToast("error", "couldn't update session permissions");
      return false;
    }
  },

  // --- Broadcast ---

  emitEdit: (op) => {
    const session = get().collab.session;
    if (!session.id || session.applyingRemote || session.role !== "editor")
      return;
    const user = get().auth.user;
    if (!user) return;
    const message: EditMessage = {
      v: COLLAB_PROTOCOL_VERSION,
      peerId: user.id,
      clientTs: Date.now(),
      op,
    };
    // Push to /sessions/{id}/edits — RTDB assigns a chronologically
    // sortable key; consumers replay in key order. Don't await: edits
    // are best-effort fire-and-forget on the broadcast path.
    void push(dbRef(rtdb, `sessions/${session.id}/edits`), message);
  },

  emitPresence: (cursor, focus) => {
    const session = get().collab.session;
    if (!session.id) return;
    const user = get().auth.user;
    if (!user) return;
    // Partial-merge updates so a cursor broadcast doesn't wipe the
    // focus field set by the previous focusCell call (and vice versa).
    // Earlier code used dbSet which overwrote the whole record — a
    // cursor tick every ~100ms erased the host's focus on cell N
    // before the invitee could render the indicator.
    const updates: Record<string, unknown> = {
      v: COLLAB_PROTOCOL_VERSION,
      peerId: user.id,
      displayName: user.displayName,
      color: pickPeerColor(user.id),
      lastSeen: Date.now(),
    };
    if (cursor !== null) updates.cursor = cursor;
    if (focus !== null) updates.focus = focus;
    void dbUpdate(
      dbRef(rtdb, `sessions/${session.id}/presence/${user.id}`),
      updates,
    );
  },
});

// --- Helpers ----------------------------------------------------------------

function attachSessionListeners(
  sessionId: string,
  set: Parameters<StateCreator<BeatsStore, [], [], CollabSlice>>[0],
  get: () => BeatsStore,
): void {
  const detach: Array<() => void> = [];

  // 1. Live participants list — used by the participant chip rail and
  //    the cursor-eviction heuristic.
  const participantsRef = dbRef(rtdb, `sessions/${sessionId}/participants`);
  const participantsHandler = (snap: DataSnapshot) => {
    const value =
      (snap.val() as Record<string, SessionParticipant> | null) ?? {};
    set((s) => ({
      collab: {
        ...s.collab,
        session: { ...s.collab.session, participants: value },
      },
    }));
  };
  onValue(participantsRef, participantsHandler);
  detach.push(() => off(participantsRef, "value", participantsHandler));

  // 2. Live presence — cursor positions + focus updates.
  const presenceRef = dbRef(rtdb, `sessions/${sessionId}/presence`);
  const presenceHandler = (snap: DataSnapshot) => {
    const value = (snap.val() as Record<string, PresenceState> | null) ?? {};
    set((s) => ({
      collab: {
        ...s.collab,
        session: { ...s.collab.session, presence: value },
      },
    }));
  };
  onValue(presenceRef, presenceHandler);
  detach.push(() => off(presenceRef, "value", presenceHandler));

  // 3. Session meta — owner can flip status to "ended" remotely; we
  //    react by tearing down our listeners and going back to solo.
  const metaRef = dbRef(rtdb, `sessions/${sessionId}/meta`);
  const metaHandler = (snap: DataSnapshot) => {
    const meta = snap.val() as SessionMeta | null;
    if (!meta) return;
    set((s) => ({
      collab: { ...s.collab, session: { ...s.collab.session, meta } },
    }));
    if (meta.status === "ended") {
      // Teardown is async (fire-and-forget) — listeners go away on
      // their own via the `detach` closures stored on the session.
      void get().leaveSession();
    }
  };
  onValue(metaRef, metaHandler);
  detach.push(() => off(metaRef, "value", metaHandler));

  // 4. Edit log — we use `child_added` rather than `value` so we
  //    receive each push individually + in chronological order. The
  //    `cutoff` ignores history that landed before we hooked up so
  //    state-from-snapshot already accounts for it.
  const cutoff = Date.now();
  const editsRef = dbRef(rtdb, `sessions/${sessionId}/edits`);
  const editsHandler = (snap: DataSnapshot) => {
    const message = snap.val() as EditMessage | null;
    if (!message) return;
    if (message.clientTs < cutoff - 30_000) return; // stale tail
    const myUid = get().auth.user?.id;
    if (myUid && message.peerId === myUid) return; // echo of our own emit
    applyRemoteEdit(set, get, message);
  };
  onChildAdded(editsRef, editsHandler);
  detach.push(() => off(editsRef, "child_added", editsHandler));

  // 5. Heartbeat — bump our presence.lastSeen every few seconds so
  //    idle peers (sitting on a cell, not moving the cursor) don't
  //    fall off the staleness filter and disappear from the matrix
  //    grid for everyone else. Uses dbUpdate so cursor + focus stay
  //    intact.
  const myUid = get().auth.user?.id;
  if (myUid) {
    const presenceSelfRef = dbRef(
      rtdb,
      `sessions/${sessionId}/presence/${myUid}`,
    );
    const heartbeat = setInterval(() => {
      void dbUpdate(presenceSelfRef, { lastSeen: Date.now() });
    }, 4000);
    detach.push(() => clearInterval(heartbeat));

    // Best-effort cleanup on disconnect (closed tab / dropped network)
    // so a peer's presence record doesn't ghost on the matrix forever.
    // Server still owns participant removal via /sessions/:id/leave.
    const disconnect = onDisconnect(presenceSelfRef);
    void disconnect.remove();
    detach.push(() => {
      void disconnect.cancel();
      // Manual remove on intentional leave — onDisconnect only fires on
      // ungraceful disconnects.
      void dbRemove(presenceSelfRef);
    });
  }

  set((s) => ({
    collab: { ...s.collab, session: { ...s.collab.session, detach } },
  }));
}

function detachSessionListeners(get: () => BeatsStore): void {
  for (const fn of get().collab.session.detach) {
    try {
      fn();
    } catch {
      // Ignore — best-effort cleanup.
    }
  }
}

/**
 * Replace the local pattern + matrix with a snapshot from the session.
 * The server returns this on join — it IS the canonical state, so we
 * apply unconditionally rather than gating on project.current. That
 * matters for invitees who aren't on the project's collaborator list:
 * we deliberately skip Firestore project hydration for them, leaving
 * project.current null. The snapshot is the only state they get.
 *
 * The shape can be a v2 ProjectMatrix or a v1 Pattern — handle both.
 */
function applyRemoteSnapshot(
  set: Parameters<StateCreator<BeatsStore, [], [], CollabSlice>>[0],
  get: () => BeatsStore,
  _projectId: string,
  state: unknown,
): void {
  if (!state || typeof state !== "object") return;
  const candidate = state as {
    schemaVersion?: number;
    cells?: unknown;
    tracks?: unknown;
    bpm?: number;
    sharedBpm?: number;
    masterGain?: number;
    stepCount?: number;
    effects?: unknown;
  };

  // Mark applyingRemote so the broadcast-back guard suppresses
  // emit-edit on the sets we're about to do (we don't want the join
  // snapshot to re-broadcast as N edits).
  set((s) => ({
    collab: {
      ...s.collab,
      session: { ...s.collab.session, applyingRemote: true },
    },
  }));
  try {
    if (candidate.schemaVersion === 2 && Array.isArray(candidate.cells)) {
      // v2 matrix snapshot. Apply matrix, then derive a flat pattern
      // for the active cell so the row grid renders correctly. The
      // existing setMatrix action moves selection to the first
      // enabled cell.
      get().setMatrix(state as never);
      get().loadCellIntoPattern(get().selectedCellId);
    } else if (
      candidate.schemaVersion === 1 &&
      Array.isArray(candidate.tracks)
    ) {
      // v1 legacy flat pattern. setPattern overwrites the local
      // pattern — the matrix mirror keeps the project displayable.
      get().setPattern(state as never);
    }
  } finally {
    set((s) => ({
      collab: {
        ...s.collab,
        session: { ...s.collab.session, applyingRemote: false },
      },
    }));
  }
}

/**
 * Apply a remote `EditOp` to the local store. The dispatcher fans out
 * to existing slice actions while the `applyingRemote` flag suppresses
 * the matching `emitEdit` call inside those actions — that's how we
 * avoid the broadcast loop.
 */
function applyRemoteEdit(
  set: Parameters<StateCreator<BeatsStore, [], [], CollabSlice>>[0],
  get: () => BeatsStore,
  message: EditMessage,
): void {
  set((s) => ({
    collab: {
      ...s.collab,
      session: { ...s.collab.session, applyingRemote: true },
    },
  }));
  try {
    const op = message.op;
    if (op.kind === "transport/play") {
      // Fire-and-forget; play() captures applyingRemote synchronously
      // before its first await, so the broadcast-skip flag survives
      // the async gap even though we reset it in the finally below.
      void get().play();
    } else if (op.kind === "transport/stop") {
      get().stop();
    } else {
      // All other EditOp kinds carry a `cellId` (or are pattern-level
      // shared state). Route through the matrix-targeted apply so
      // remote ops land on the cell the host actually changed instead
      // of whichever cell this peer happens to have selected. The
      // previous per-op dispatch leaked through the local pattern
      // slice and silently mis-targeted edits.
      get().applyRemoteEditOp(op);
    }
  } finally {
    set((s) => ({
      collab: {
        ...s.collab,
        session: { ...s.collab.session, applyingRemote: false },
      },
    }));
  }
}
