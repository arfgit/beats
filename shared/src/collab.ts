import type { EffectKind, TrackKind } from "./types.js";

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
  | { kind: "cell/setName"; cellId: string; name: string };

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
  lastSeen: number;
}

/** Session metadata at `/sessions/{id}/meta`. */
export interface SessionMeta {
  v: typeof COLLAB_PROTOCOL_VERSION;
  sessionId: string;
  projectId: string;
  ownerUid: string;
  createdAt: number;
  /** "open" while the session accepts joins; "ended" after the owner leaves. */
  status: "open" | "ended";
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
