export const SCHEMA_VERSION = 1;
export const STEP_COUNT = 8;
export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const MAX_RECORDING_MS = 120_000;

export const TRACK_KINDS = ["drums", "bass", "guitar", "vocals"] as const;
export const EFFECT_KINDS = [
  "chorus",
  "phaser",
  "tremolo",
  "moogFilter",
] as const;

export const API_BASE = "/api";
