export const SCHEMA_VERSION = 1;
export const STEP_COUNT = 8;
export const BPM_MIN = 60;
export const BPM_MAX = 200;
/**
 * Legacy hard cap that still applies when the caller can't derive a
 * matrix-aware cap (e.g., before the matrix loads). Matrix transport
 * uses `computeMatrixRecordingCapMs` instead.
 */
export const MAX_RECORDING_MS = 120_000;
/**
 * Above this duration we skip the WAV expansion step in the worker and
 * download the MediaRecorder container directly. Long recordings in WAV
 * balloon to hundreds of MB in memory, which kills mobile browsers per
 * codex's H-5 finding. Compressed container is always smaller and keeps
 * the export feature usable past the 2-minute mark.
 */
export const WAV_CAP_MS = 120_000;

/**
 * Every TrackKind a user can pick for a row. The first four are what
 * appear as defaults in a fresh cell (see DEFAULT_CELL_KINDS below);
 * "fx" unlocks the synth / ambient / glitch corner of the library but
 * has to be selected manually via the row's kind dropdown.
 */
export const TRACK_KINDS = ["drums", "bass", "guitar", "vocals", "fx"] as const;

/**
 * Default row assignments for a brand-new cell. Always four entries —
 * the matrix UI is hard-wired to a 4-row grid. Decoupling this from
 * `TRACK_KINDS` lets us add new kinds (fx, and future) without inflating
 * the default row count.
 */
export const DEFAULT_CELL_KINDS = [
  "drums",
  "bass",
  "guitar",
  "vocals",
] as const;

/** Number of rows in every cell's pattern. The server Zod validator
 * uses this for the `.length(...)` constraint so existing projects stay
 * valid even as TRACK_KINDS grows. */
export const TRACKS_PER_CELL = 4;
export const EFFECT_KINDS = [
  "chorus",
  "phaser",
  "tremolo",
  "moogFilter",
] as const;

export const API_BASE = "/api";
