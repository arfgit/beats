import type { EffectKind, Track, TrackKind } from "./types.js";

/**
 * Wire shapes for the live-collab feature. The same types are used on
 * both sides — server validates incoming `EditOp` payloads against the
 * Zod schemas in server/src/lib/schemas.ts; client emits matching ops.
 *
 * Conflict resolution model: server-authoritative serialization. Each
 * `EditOp` lands in `/sessions/{id}/edits/{pushId}` via RTDB push; the
 * push key gives a chronological order. Peers replay edits in that
 * order and converge. "Conflict" = two ops on the same address (e.g.
 * same step) — the later push wins, and both peers see the same final
 * state.
 *
 * Versioning: every wrapper carries a `v` field. Bump on breaking
 * changes; additive new op kinds don't bump.
 */

export const COLLAB_PROTOCOL_VERSION = 1;

/**
 * Discriminated union of every state mutation a peer can broadcast.
 * Field names mirror the existing patternSlice / matrixSlice action
 * shapes — the apply layer fans out via `kind` to the corresponding
 * store action (with a `fromRemote: true` guard so the broadcast
 * layer doesn't echo back).
 */
export type EditOp =
  | { kind: "matrix/toggleStep"; cellId: string; trackId: string; step: number }
  | {
      kind: "matrix/setStepVelocity";
      cellId: string;
      trackId: string;
      step: number;
      velocity: number;
    }
  | {
      kind: "matrix/setStepSample";
      cellId: string;
      trackId: string;
      step: number;
      sampleId: string;
      sampleVersion: number;
      sampleName?: string | null;
    }
  | {
      kind: "track/setSample";
      cellId: string;
      trackId: string;
      sampleId: string;
      sampleVersion: number;
      sampleName?: string | null;
    }
  | {
      kind: "track/setName";
      cellId: string;
      trackId: string;
      name: string;
    }
  | { kind: "track/setGain"; cellId: string; trackId: string; gain: number }
  | { kind: "track/toggleMute"; cellId: string; trackId: string }
  | { kind: "track/toggleSolo"; cellId: string; trackId: string }
  | {
      kind: "track/setKind";
      cellId: string;
      trackId: string;
      newKind: TrackKind;
    }
  | { kind: "track/clearSample"; cellId: string; trackId: string }
  | {
      kind: "track/setAllSteps";
      cellId: string;
      trackId: string;
      active: boolean;
    }
  // Composite reset of gain + mute + solo to defaults. Wired as a
  // single op so peers don't have to interpret three sequential ops
  // as a "reset" — clearer intent + atomic apply.
  | { kind: "track/resetMixer"; cellId: string; trackId: string }
  | { kind: "pattern/setBpm"; bpm: number }
  | { kind: "pattern/setMasterGain"; gain: number }
  | {
      kind: "pattern/setEffectParam";
      cellId: string;
      effectKind: EffectKind;
      key: string;
      value: number;
    }
  | {
      kind: "pattern/toggleEffect";
      cellId: string;
      effectKind: EffectKind;
    }
  | { kind: "pattern/clearAllSteps"; cellId: string }
  | { kind: "cell/setEnabled"; cellId: string; enabled: boolean }
  | { kind: "cell/setName"; cellId: string; name: string }
  // Structural matrix ops — add/remove/reorder tracks within a cell
  // and reorder cells in the matrix. Without these, any add-track or
  // drag-reorder on one peer leaves the other peers with a different
  // matrix layout, and subsequent step edits silently no-op when the
  // referenced trackId/cellId doesn't exist on the receiving side.
  | { kind: "track/add"; cellId: string; track: Track }
  | { kind: "track/remove"; cellId: string; trackId: string }
  | {
      kind: "track/reorder";
      cellId: string;
      fromIndex: number;
      toIndex: number;
    }
  | { kind: "cell/reorder"; fromIndex: number; toIndex: number }
  // Transport ops broadcast playback state across the session so peers
  // hear the same loop together. Drift between peers is unavoidable
  // (each client runs its own audio clock) but the start/stop signal
  // arrives within network latency, which is good enough for jamming.
  | { kind: "transport/play" }
  | { kind: "transport/stop" };

/**
 * Edit envelope written to `/sessions/{id}/edits/{pushId}`. The
 * `clientTs` is informational (debugging, latency metrics); ordering
 * is determined by the RTDB push key, which is chronologically sortable.
 */
export interface EditMessage {
  v: typeof COLLAB_PROTOCOL_VERSION;
  peerId: string;
  clientTs: number;
  op: EditOp;
}

/**
 * Presence shape written to `/sessions/{id}/presence/{uid}`. Updated
 * at ~10Hz from the client; consumers throttle their rerenders so the
 * cursor render path stays cheap. `cursor` is normalized [0,1] coords
 * relative to the studio root so different viewport sizes line up.
 */
export interface PresenceState {
  v: typeof COLLAB_PROTOCOL_VERSION;
  peerId: string;
  displayName: string;
  color: string;
  cursor?: { x: number; y: number };
  focus?: {
    cellId?: string;
    trackId?: string;
    step?: number;
  };
  /**
   * Most recent edit this peer made — written each time emitEdit fires.
   * Receivers use it to flash a brief peer-colored pulse on the
   * affected cell so a drag, toggle, or any other op is visibly
   * attributable to whoever made it. Decays naturally as new edits
   * overwrite it. Optional so existing presence records without it
   * still parse.
   */
  lastEdit?: {
    cellId?: string;
    at: number;
  };
  lastSeen: number;
}

/**
 * Host-controlled toggles that gate destructive / matrix-wide actions
 * for non-host participants. Host can flip these live during the
 * session via `PATCH /sessions/{id}/permissions`.
 */
export interface SessionPermissions {
  /**
   * When false, invitees can still toggle individual steps and edit
   * cell-local content, but matrix-wide buttons (clear matrix,
   * enable/disable all cells, seed demo) are disabled in their UI.
   * Default is `false` (locked) so the host's beat is protected unless
   * they explicitly open it up.
   */
  inviteesCanEditGlobal: boolean;
}

export const DEFAULT_SESSION_PERMISSIONS: SessionPermissions = {
  inviteesCanEditGlobal: false,
};

/** Session metadata at `/sessions/{id}/meta`. */
export interface SessionMeta {
  v: typeof COLLAB_PROTOCOL_VERSION;
  sessionId: string;
  projectId: string;
  /**
   * Project title at session start. Snapshotted here so non-collaborator
   * invitees (who can't read the project doc directly) can still display
   * "in <host>'s session: <title>" in the studio chrome. Stale if the
   * host renames mid-session — acceptable for v1.
   */
  projectTitle: string;
  ownerUid: string;
  /** Owner's display name. Same rationale as projectTitle — invitees
   *  need a label without project read access. */
  ownerDisplayName: string;
  createdAt: number;
  /** "open" while the session accepts joins; "ended" after the owner leaves. */
  status: "open" | "ended";
  /**
   * Host-controlled gating for invitee actions. Optional on the wire so
   * an older client/session without the field still works — clients
   * fall back to `DEFAULT_SESSION_PERMISSIONS` (locked).
   */
  permissions?: SessionPermissions;
}

/** Participant slot at `/sessions/{id}/participants/{uid}`. */
export interface SessionParticipant {
  v: typeof COLLAB_PROTOCOL_VERSION;
  uid: string;
  displayName: string;
  color: string;
  joinedAt: number;
  /**
   * `editor` can broadcast EditOps; `viewer` can join + see + receive
   * presence but not write edits. v1 ships with everyone-is-editor by
   * default; the field is here for forward compatibility (owner
   * promotion via a future endpoint).
   */
  role: "editor" | "viewer";
}
