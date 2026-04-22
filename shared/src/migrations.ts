import {
  DEFAULT_CELL_KINDS,
  SCHEMA_VERSION,
  STEP_COUNT,
  EFFECT_KINDS,
} from "./constants.js";
import type {
  Pattern,
  Track,
  EffectState,
  MixerCell,
  MixerPattern,
  ProjectMatrix,
  ProjectPattern,
} from "./types.js";
import { isProjectMatrix } from "./types.js";

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
    tracks: DEFAULT_CELL_KINDS.map((kind) => ({
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

// ---------- v2 ProjectMatrix helpers (used by C1 client migration) ----------

export const MATRIX_CELL_COUNT = 9;

export function createEmptyMixerPattern(): MixerPattern {
  return {
    stepCount: STEP_COUNT,
    // Track ids match the legacy `track-${kind}` scheme so the engine's
    // pre-created voices (keyed by the same id) route correctly. When the
    // user picks a new kind for a slot via setTrackKind, the track id
    // stays as-is — the engine looks up by id, not by current kind, so
    // the voice chain is stable across kind changes. One known MVP
    // limitation: two tracks of the same kind in one cell currently
    // share a voice (second-to-fire wins). Fix with per-slot voices in
    // a later phase.
    tracks: DEFAULT_CELL_KINDS.map((kind) => ({
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
  };
}

export function createEmptyMixerCell(id: string): MixerCell {
  return {
    id,
    enabled: false,
    pattern: createEmptyMixerPattern(),
    effects: EFFECT_KINDS.map((kind) => ({
      kind,
      enabled: false,
      params: defaultEffectParams(kind),
    })),
  };
}

export function createDefaultMatrix(): ProjectMatrix {
  return {
    schemaVersion: 2,
    sharedBpm: 120,
    masterGain: 0.8,
    cells: Array.from({ length: MATRIX_CELL_COUNT }, (_, i) =>
      // First cell is enabled so the transport has something to play out of
      // the box; the rest start disabled and the user toggles them on.
      i === 0
        ? { ...createEmptyMixerCell(`c${i}`), enabled: true }
        : createEmptyMixerCell(`c${i}`),
    ),
  };
}

/**
 * Lift a legacy v1 Pattern into a v2 ProjectMatrix. The old pattern
 * becomes cell 0 (enabled); cells 1–8 are created empty/disabled. BPM
 * and master gain move up to the matrix root. Used during client-side
 * migration on project load.
 */
export function migratePatternToMatrix(legacy: Pattern): ProjectMatrix {
  const cell0: MixerCell = {
    id: "c0",
    enabled: true,
    pattern: {
      stepCount: legacy.stepCount,
      tracks: legacy.tracks,
    },
    effects: legacy.effects,
  };
  return {
    schemaVersion: 2,
    sharedBpm: legacy.bpm,
    masterGain: legacy.masterGain,
    cells: [
      cell0,
      ...Array.from({ length: MATRIX_CELL_COUNT - 1 }, (_, i) =>
        createEmptyMixerCell(`c${i + 1}`),
      ),
    ],
  };
}

/**
 * Display summary compatible with both v1 and v2 shapes — used by the
 * gallery / admin cards that need to show bpm + track count + effect
 * count without knowing which schema the project is on.
 */
export interface ProjectSummary {
  bpm: number;
  masterGain: number;
  trackCount: number;
  effectsEnabled: number;
  /** For matrix projects only: how many cells are toggled on. */
  enabledCellCount?: number;
  schemaVersion: number;
}

/**
 * Recording cap for the matrix transport = ceil(loopSec + 2) * 1000.
 * One full loop of the matrix is sum-of-enabled-cells × secondsPerBar,
 * assuming one bar per cell (the current transport cadence). The +2s
 * tail lets reverb / delay decay naturally past the final beat.
 *
 * Beats-per-bar is hardcoded to 4 here because the sequencer's 8 steps
 * are 8th notes in 4/4 — if that ever becomes configurable, thread it
 * through.
 */
const BEATS_PER_BAR = 4;
export function computeMatrixRecordingCapMs(matrix: ProjectMatrix): number {
  const enabledCount = matrix.cells.filter((c) => c.enabled).length || 1;
  const secondsPerBeat = 60 / matrix.sharedBpm;
  const loopSec = enabledCount * BEATS_PER_BAR * secondsPerBeat;
  return Math.ceil(loopSec + 2) * 1000;
}

export function getProjectSummary(pattern: ProjectPattern): ProjectSummary {
  if (isProjectMatrix(pattern)) {
    const firstEnabled =
      pattern.cells.find((c) => c.enabled) ?? pattern.cells[0];
    const effectsEnabled = pattern.cells.reduce(
      (sum, c) => sum + c.effects.filter((e) => e.enabled).length,
      0,
    );
    return {
      schemaVersion: 2,
      bpm: pattern.sharedBpm,
      masterGain: pattern.masterGain,
      trackCount: firstEnabled?.pattern.tracks.length ?? 0,
      effectsEnabled,
      enabledCellCount: pattern.cells.filter((c) => c.enabled).length,
    };
  }
  return {
    schemaVersion: pattern.schemaVersion,
    bpm: pattern.bpm,
    masterGain: pattern.masterGain,
    trackCount: pattern.tracks.length,
    effectsEnabled: pattern.effects.filter((e) => e.enabled).length,
  };
}
