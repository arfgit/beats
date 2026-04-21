import {
  SCHEMA_VERSION,
  STEP_COUNT,
  TRACK_KINDS,
  EFFECT_KINDS,
} from "./constants.js";
import type { Pattern, Track, EffectState } from "./types.js";

type Migrator = (doc: unknown) => unknown;

const migrators: Record<number, Migrator> = {
  // Placeholder for future: migrate from v1 → v2, v2 → v3, etc.
};

export function migratePattern(raw: unknown): Pattern {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid pattern document");
  }
  let doc = raw as { schemaVersion?: number };
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1;

  while (version < SCHEMA_VERSION) {
    const migrator = migrators[version];
    if (!migrator) {
      throw new Error(`no migrator from schemaVersion ${version}`);
    }
    doc = migrator(doc) as typeof doc;
    version += 1;
  }

  const validated = validatePattern(doc);
  return validated;
}

function validatePattern(doc: unknown): Pattern {
  if (!doc || typeof doc !== "object") {
    throw new Error("pattern is not an object");
  }
  const p = doc as Partial<Pattern>;
  if (typeof p.bpm !== "number" || typeof p.masterGain !== "number") {
    throw new Error("pattern missing bpm or masterGain");
  }
  if (!Array.isArray(p.tracks) || !Array.isArray(p.effects)) {
    throw new Error("pattern missing tracks or effects");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    bpm: p.bpm,
    masterGain: p.masterGain,
    stepCount: p.stepCount ?? STEP_COUNT,
    tracks: p.tracks as Track[],
    effects: p.effects as EffectState[],
  };
}

export function createDefaultPattern(): Pattern {
  return {
    schemaVersion: SCHEMA_VERSION,
    bpm: 120,
    masterGain: 0.8,
    stepCount: STEP_COUNT,
    tracks: TRACK_KINDS.map((kind) => ({
      id: `track-${kind}`,
      kind,
      sampleId: null,
      sampleVersion: null,
      gain: 0.8,
      muted: false,
      soloed: false,
      steps: Array.from({ length: STEP_COUNT }, () => ({
        active: false,
        velocity: 1,
      })),
    })),
    effects: EFFECT_KINDS.map((kind) => ({
      kind,
      enabled: false,
      params: defaultEffectParams(kind),
    })),
  };
}

function defaultEffectParams(
  kind: (typeof EFFECT_KINDS)[number],
): Record<string, number> {
  switch (kind) {
    case "chorus":
      return { wet: 0.5, frequency: 1.5, depth: 0.5 };
    case "phaser":
      return { wet: 0.5, frequency: 0.5, octaves: 3 };
    case "tremolo":
      return { wet: 0.5, frequency: 5, depth: 0.5 };
    case "moogFilter":
      return { wet: 0.5, cutoff: 1200, resonance: 1 };
  }
}
