import type { StateCreator } from "zustand";
import {
  ref as dbRef,
  off,
  onChildAdded,
  onValue,
  push,
  remove,
  serverTimestamp,
  set as dbSet,
  type DataSnapshot,
  type Unsubscribe,
} from "firebase/database";
import {
  COLLAB_PROTOCOL_VERSION,
  type EditMessage,
  type EditOp,
  type PresenceState,
  type SessionMeta,
  type SessionParticipant,
} from "@beats/shared";
import { rtdb } from "@/lib/firebase";
import { api } from "@/lib/api";
import { updateCurrentSession } from "@/lib/global-presence";
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
      return result.sessionId;
    } catch (err) {
      // eslint-disable-next-line no-console
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
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[collab] joinSession failed", err);
      return false;
    }
  },

  leaveSession: async () => {
    const sessionId = get().collab.session.id;
    if (!sessionId) return;
    detachSessionListeners(get);
    try {
      await api.post(`/sessions/${sessionId}/leave`, {});
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[collab] leaveSession server call failed", err);
    }
    set((s) => ({ collab: { ...s.collab, session: freshSession() } }));
    updateCurrentSession(null);
    // Re-arm the legacy Firestore presence on the project we were in,
    // and re-subscribe to the project's onSnapshot listener so remote
    // edits made outside the session (e.g. another tab) start landing
    // again.
    const projectId = get().project.current?.id;
    if (projectId) {
      void get().loadProject(projectId);
      get().startCollab(projectId);
    }
  },

  endSession: async () => {
    const sessionId = get().collab.session.id;
    if (!sessionId) return;
    detachSessionListeners(get);
    try {
      await api.delete(`/sessions/${sessionId}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[collab] endSession server call failed", err);
    }
    set((s) => ({ collab: { ...s.collab, session: freshSession() } }));
    updateCurrentSession(null);
    const projectId = get().project.current?.id;
    if (projectId) get().startCollab(projectId);
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
    const presence: PresenceState = {
      v: COLLAB_PROTOCOL_VERSION,
      peerId: user.id,
      displayName: user.displayName,
      color: pickPeerColor(user.id),
      lastSeen: Date.now(),
      ...(cursor !== null && { cursor }),
      ...(focus !== null && { focus }),
    };
    void dbSet(
      dbRef(rtdb, `sessions/${session.id}/presence/${user.id}`),
      presence,
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
  void serverTimestamp; // keep import live for future "lastEditAt" writes
  void remove; // imported for future participant-eviction calls
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
    const store = get();
    switch (op.kind) {
      case "matrix/toggleStep":
        store.toggleStep(op.trackId, op.step);
        break;
      case "matrix/setStepVelocity":
        store.setStepVelocity(op.trackId, op.step, op.velocity);
        break;
      case "matrix/setStepSample":
        store.setStepSample(op.trackId, op.step, op.sampleId, op.sampleVersion);
        break;
      case "track/setSample":
        store.setTrackSample(op.trackId, op.sampleId, op.sampleVersion);
        break;
      case "track/setName":
        store.setTrackName(op.trackId, op.name);
        break;
      case "track/setGain":
        store.setTrackGain(op.trackId, op.gain);
        break;
      case "track/toggleMute":
        store.toggleMute(op.trackId);
        break;
      case "track/toggleSolo":
        store.toggleSolo(op.trackId);
        break;
      case "track/setKind":
        store.setTrackKind(op.cellId, op.trackId, op.newKind);
        break;
      case "track/clearSample":
        store.clearTrackSample(op.trackId);
        break;
      case "track/setAllSteps":
        store.setAllStepsOnTrack(op.trackId, op.active);
        break;
      case "pattern/setBpm":
        store.setBpm(op.bpm);
        break;
      case "pattern/setMasterGain":
        store.setMasterGain(op.gain);
        break;
      case "pattern/setEffectParam":
        store.setEffectParam(op.effectKind, op.key, op.value);
        break;
      case "pattern/toggleEffect":
        store.toggleEffect(op.effectKind);
        break;
      case "pattern/clearAllSteps":
        store.clearAllSteps();
        break;
      case "cell/setEnabled":
        store.toggleCellEnabled(op.cellId);
        break;
      case "cell/setName":
        // setCellName is wired via uiSlice / projectSlice; stub for now.
        // Until that handler exists, silently no-op so a peer renaming
        // a cell doesn't crash the apply path.
        break;
      default: {
        // Exhaustiveness check — TS will yell if we add a new EditOp
        // kind without handling it here.
        const _exhaustive: never = op;
        void _exhaustive;
      }
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
