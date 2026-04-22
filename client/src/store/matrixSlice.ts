import type { StateCreator } from "zustand";
import { produce } from "immer";
import type {
  MixerCell,
  Pattern,
  ProjectMatrix,
  SampleRef,
  Track,
  TrackKind,
} from "@beats/shared";
import {
  createDefaultMatrix,
  createEmptyMixerCell,
  createEmptyTrack,
  EFFECT_KINDS,
  MATRIX_CELL_COUNT,
  STEP_COUNT,
  TRACK_KINDS,
} from "@beats/shared";
import type { BeatsStore } from "./useBeatsStore";

export interface MatrixSlice {
  /**
   * v2 project state — source of truth for persistence. Cell pattern
   * contents for the currently-selected cell are lazily mirrored from the
   * flat `pattern` field at save time / cell-switch time so the UI can keep
   * editing via patternSlice as it does today.
   */
  matrix: ProjectMatrix;
  /** The cell currently being edited. Initialized to the first cell. */
  selectedCellId: string;
  /**
   * The cell currently being played by the matrix transport. Engine-owned;
   * UI reads for highlight. Null when transport is stopped.
   */
  activeCellId: string | null;

  // ---- persistence hooks ----
  setMatrix: (matrix: ProjectMatrix) => void;
  resetMatrix: () => void;

  // ---- selection ----
  setSelectedCellId: (id: string) => void;
  setActiveCellId: (id: string | null) => void;

  // ---- matrix-level mutations ----
  toggleCellEnabled: (cellId: string) => void;
  /** Move a cell to a new index in the row-major cells[] array. */
  reorderCells: (fromIndex: number, toIndex: number) => void;
  /** Reorder track slots within a single cell. */
  reorderTracks: (cellId: string, fromIndex: number, toIndex: number) => void;
  /** Change the instrument kind of a specific slot (duplicates allowed). */
  setTrackKind: (cellId: string, trackId: string, kind: TrackKind) => void;
  /** Append a new track of the given kind to the cell's track list. */
  addTrack: (cellId: string, kind: TrackKind) => void;
  /** Remove a track from the cell. No-op when it would leave the cell empty. */
  removeTrack: (cellId: string, trackId: string) => void;
  /** Deactivate every step on every track across every cell in the matrix. */
  clearAllCellSteps: () => void;
  /** Flip `enabled` on every cell in the matrix. */
  toggleAllCellsEnabled: () => void;
  /** Rename a cell — empty string clears back to "cell N" default. */
  setCellName: (cellId: string, name: string) => void;
  /**
   * Replace the matrix with a pre-programmed demo beat that uses all 9
   * cells in a progressive arrangement. Fetches samples for each kind
   * if not already loaded. Used by the "seed demo" button.
   */
  generateDemoBeat: () => Promise<void>;

  // ---- sync helpers ----
  /**
   * Apply the current flat `pattern` back into the selected cell's slot
   * in matrix. Also pushes shared bpm / masterGain into the matrix root.
   * Called before save and before switching cells.
   */
  syncPatternIntoMatrix: () => void;
  /**
   * Load a specific cell's contents into the flat `pattern` editing state
   * (and update shared bpm / masterGain). Does not touch selectedCellId —
   * caller drives that via setSelectedCellId, which invokes this.
   */
  loadCellIntoPattern: (cellId: string) => void;
}

function ensureCellId(matrix: ProjectMatrix, candidate: string): string {
  if (matrix.cells.some((c) => c.id === candidate)) return candidate;
  return matrix.cells[0]?.id ?? "c0";
}

export const createMatrixSlice: StateCreator<
  BeatsStore,
  [],
  [],
  MatrixSlice
> = (set, get) => {
  const initial = createDefaultMatrix();
  return {
    matrix: initial,
    selectedCellId: initial.cells[0]!.id,
    activeCellId: null,

    setMatrix: (matrix) => {
      // When a new matrix arrives (e.g., from project load), move selection
      // to the first enabled cell — or the first cell if none are enabled.
      const firstEnabled =
        matrix.cells.find((c) => c.enabled) ?? matrix.cells[0];
      set({
        matrix,
        selectedCellId: firstEnabled?.id ?? matrix.cells[0]?.id ?? "c0",
      });
    },

    resetMatrix: () => {
      const fresh = createDefaultMatrix();
      set({
        matrix: fresh,
        selectedCellId: fresh.cells[0]!.id,
        activeCellId: null,
      });
    },

    setSelectedCellId: (id) => {
      const currentId = get().selectedCellId;
      if (id === currentId) return;
      // Flush any in-progress edits on the previous cell BEFORE swapping,
      // otherwise the switch would drop the pattern changes that haven't
      // been synced into matrix yet.
      get().syncPatternIntoMatrix();
      set({ selectedCellId: ensureCellId(get().matrix, id) });
      get().loadCellIntoPattern(id);
      // Undo history is pattern-scoped (patches replay against the flat
      // pattern field). After swapping cells, replaying patches from the
      // previous cell would land on the wrong tracks. Clearing history is
      // the safe minimum — per-cell history is a future improvement.
      get().clearHistory();
    },

    setActiveCellId: (id) => {
      set({ activeCellId: id });
    },

    toggleCellEnabled: (cellId) => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (cell) cell.enabled = !cell.enabled;
        }),
      }));
    },

    reorderCells: (fromIndex, toIndex) => {
      const max = MATRIX_CELL_COUNT - 1;
      if (fromIndex < 0 || fromIndex > max) return;
      if (toIndex < 0 || toIndex > max) return;
      if (fromIndex === toIndex) return;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const [moved] = draft.cells.splice(fromIndex, 1);
          if (moved) draft.cells.splice(toIndex, 0, moved);
        }),
      }));
    },

    reorderTracks: (cellId, fromIndex, toIndex) => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          const max = cell.pattern.tracks.length - 1;
          if (fromIndex < 0 || fromIndex > max) return;
          if (toIndex < 0 || toIndex > max) return;
          if (fromIndex === toIndex) return;
          const [moved] = cell.pattern.tracks.splice(fromIndex, 1);
          if (moved) cell.pattern.tracks.splice(toIndex, 0, moved);
        }),
      }));
    },

    addTrack: (cellId, kind) => {
      const track = createEmptyTrack(kind);
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          cell.pattern.tracks.push(track);
        }),
      }));
    },

    removeTrack: (cellId, trackId) => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          if (cell.pattern.tracks.length <= 1) return;
          cell.pattern.tracks = cell.pattern.tracks.filter(
            (t) => t.id !== trackId,
          );
        }),
      }));
    },

    clearAllCellSteps: () => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          for (const cell of draft.cells) {
            for (const track of cell.pattern.tracks) {
              for (const step of track.steps) step.active = false;
            }
          }
        }),
      }));
      // Also reflect the wipe onto the currently-loaded flat pattern so the
      // grid UI shows the cleared state immediately (matrix mirror alone
      // leaves the pattern slice stale until the next cell-switch).
      get().loadCellIntoPattern(get().selectedCellId);
    },

    setCellName: (cellId, name) => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            delete cell.name;
          } else {
            cell.name = trimmed.slice(0, 24);
          }
        }),
      }));
    },

    toggleAllCellsEnabled: () => {
      // Smart semantics: if any cell is currently enabled, disable all.
      // Otherwise, enable all. Flipping each independently is confusing
      // when the matrix starts with cell 0 enabled by default — the
      // first click would leave the user with "every cell except the
      // first," which nobody asks for.
      const anyEnabled = get().matrix.cells.some((c) => c.enabled);
      const next = !anyEnabled;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          for (const cell of draft.cells) cell.enabled = next;
        }),
      }));
    },

    setTrackKind: (cellId, trackId, kind) => {
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          const track = cell?.pattern.tracks.find((t) => t.id === trackId);
          if (!track) return;
          if (track.kind === kind) return;
          track.kind = kind;
          // Kind change wipes the row: the old sample belongs to a
          // different instrument library and the existing step positions
          // were programmed for a different-feeling instrument. Leaving
          // either behind plays a kick where the user expected a vocal
          // on the first bar after swap — surprising and never what the
          // user wants. Clear everything, let them start fresh.
          track.sampleId = null;
          track.sampleVersion = null;
          for (const step of track.steps) {
            step.active = false;
            step.velocity = 1;
          }
        }),
      }));
    },

    syncPatternIntoMatrix: () => {
      const pattern = get().pattern;
      const selectedCellId = get().selectedCellId;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          draft.sharedBpm = pattern.bpm;
          draft.masterGain = pattern.masterGain;
          const cell = draft.cells.find((c) => c.id === selectedCellId);
          if (!cell) return;
          cell.pattern.stepCount = pattern.stepCount;
          cell.pattern.tracks = pattern.tracks;
          cell.effects = pattern.effects;
        }),
      }));
    },

    loadCellIntoPattern: (cellId) => {
      const { matrix } = get();
      const cell = matrix.cells.find((c) => c.id === cellId);
      if (!cell) return;
      const asPattern: Pattern = {
        schemaVersion: 1,
        bpm: matrix.sharedBpm,
        masterGain: matrix.masterGain,
        stepCount: cell.pattern.stepCount,
        tracks: cell.pattern.tracks,
        effects: cell.effects,
      };
      // Use setPattern so the existing outer subscribe marks the project
      // dirty and the sync glue stays happy. The apply path is identical
      // to "remote snapshot arrived" from the store's perspective.
      get().setPattern(asPattern);
    },

    generateDemoBeat: async () => {
      // Ensure sample libraries are loaded for every instrument kind.
      // fetchSamples is idempotent + cached per-kind in samplesSlice.
      await Promise.all(TRACK_KINDS.map((kind) => get().fetchSamples(kind)));
      const s = get();
      // Resolve each kind from the store — fx may be empty if the
      // library hasn't been expanded yet, so we tolerate absence.
      const byKind: SamplesByKind = {
        drums: s.samples.drums.samples,
        bass: s.samples.bass.samples,
        guitar: s.samples.guitar.samples,
        vocals: s.samples.vocals.samples,
        fx: s.samples.fx?.samples ?? [],
      };
      // Minimum bar to compose any demo: drums + one tonal kind (bass).
      // Missing guitar/vocals/fx just leaves those slots empty for that
      // demo rather than hard-failing.
      if (byKind.drums.length === 0 || byKind.bass.length === 0) {
        s.pushToast(
          "error",
          "demo needs drums + bass samples — check the library",
        );
        return;
      }
      // Pick the next composer in rotation so repeated clicks of the
      // "seed demo" button cycle through the available arrangements.
      const composer = DEMO_COMPOSERS[demoIndex % DEMO_COMPOSERS.length]!;
      demoIndex = (demoIndex + 1) % DEMO_COMPOSERS.length;
      const matrix = composer(byKind);
      // Replace the matrix and drop onto cell 0 for editing.
      set({
        matrix,
        selectedCellId: matrix.cells[0]!.id,
        activeCellId: null,
      });
      // Push the first cell into the flat pattern so the studio grid
      // reflects the demo immediately.
      get().loadCellIntoPattern(matrix.cells[0]!.id);
      get().clearHistory();
      s.pushToast("success", `demo beat: ${composer.beatName} — hit play`);
    },
  };
};

// ---------- demo beat composition ----------

type SamplesByKind = Record<TrackKind, SampleRef[]>;

/** Find a sample whose category matches; falls back to the first entry. */
function pickByCategory(samples: SampleRef[], category: string): SampleRef {
  return samples.find((s) => s.category === category) ?? samples[0]!;
}

/** Build a single track with a chosen sample + an 8-step pattern. */
function buildTrack(
  id: string,
  kind: TrackKind,
  sample: SampleRef | null,
  stepsActive: readonly number[],
  gain = 0.8,
  velocities?: Partial<Record<number, number>>,
): Track {
  return {
    id,
    kind,
    sampleId: sample?.id ?? null,
    sampleVersion: sample?.version ?? null,
    gain,
    muted: false,
    soloed: false,
    steps: Array.from({ length: STEP_COUNT }, (_, i) => ({
      active: stepsActive.includes(i),
      velocity: velocities?.[i] ?? 1,
    })),
  };
}

/**
 * Default effect chain for a demo cell. Effects named in `enabledKinds`
 * ship engaged so a freshly-seeded demo sounds like the composer
 * intended — previously they were always disabled while the knobs still
 * showed tweaked values, which confused users who turned the cell on
 * and heard no effect.
 */
function demoEffects(enabledKinds: readonly EffectKind[] = []) {
  return EFFECT_KINDS.map((kind) => ({
    kind,
    enabled: enabledKinds.includes(kind),
    params:
      kind === "chorus"
        ? { wet: 0.4, frequency: 1.5, depth: 0.5 }
        : kind === "phaser"
          ? { wet: 0.35, frequency: 0.5, octaves: 3 }
          : kind === "tremolo"
            ? { wet: 0.35, frequency: 5, depth: 0.5 }
            : { wet: 0.5, cutoff: 1800, resonance: 1.2 },
  }));
}

/** Safe pick: returns `null` when the library has nothing of this kind. */
function pickOrNull(samples: SampleRef[], i = 0): SampleRef | null {
  if (samples.length === 0) return null;
  return samples[Math.min(i, samples.length - 1)]!;
}

/**
 * Assemble a full ProjectMatrix from per-cell track definitions. Shared
 * helper so each demo composer can focus on the musical decisions
 * instead of matrix plumbing.
 */
function assembleMatrix(
  cellDefs: Array<{
    id: string;
    tracks: Track[];
    enabled: boolean;
    enabledEffects?: readonly EffectKind[];
  }>,
  sharedBpm: number,
  defaultEffects: readonly EffectKind[] = [],
): ProjectMatrix {
  return {
    schemaVersion: 2,
    sharedBpm,
    masterGain: 0.8,
    cells: cellDefs.map((def) => ({
      id: def.id,
      enabled: def.enabled,
      pattern: { stepCount: STEP_COUNT, tracks: def.tracks },
      effects: demoEffects(def.enabledEffects ?? defaultEffects),
    })),
  };
}

// ----- Composer #1: Neon Pulse (original progressive 9-cell arc) ------

const neonPulseDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const clap = pickByCategory(byKind.drums, "clap");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 1)!;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const guitarB = pickOrNull(byKind.guitar, 1);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 1);

    // Step positions use 0-indexed slots (0..7). Each bar is 8th-notes.
    const cellDefs = [
      // Cell 0 — Intro groove: solo kick + hihat
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "drums", hihat, [1, 3, 5, 7], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bass pulse
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "drums", hihat, [1, 3, 5, 7], 0.45),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Add clap backbeat (build)
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "drums", clap, [2, 6], 0.8),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.45),
        ],
      },
      // Cell 3 — Drop: four-on-the-floor + driving bass + snare backbeat
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 2, 4, 6], 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.7,
          ),
          buildTrack("track-guitar", "drums", snare, [2, 6], 0.85),
          buildTrack(
            "track-vocals",
            "drums",
            hihat,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.4,
          ),
        ],
      },
      // Cell 4 — Breakdown: sparse atmosphere
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0]),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.7),
        ],
      },
      // Cell 5 — Guitar hook introduced
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.7, {
            0: 1,
            2: 0.7,
            4: 1,
            6: 0.7,
          }),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.45),
        ],
      },
      // Cell 6 — Full groove: drums + bass + guitar + hats
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "guitar", guitarA, [0, 3, 4, 7], 0.7),
          buildTrack("track-vocals", "drums", snare, [2, 6], 0.85),
        ],
      },
      // Cell 7 — Vocal moment
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.6),
          buildTrack("track-guitar", "guitar", guitarB, [0, 4], 0.6),
          buildTrack("track-vocals", "vocals", vocalB, [2, 6], 0.9),
        ],
      },
      // Cell 8 — Finale / crescendo
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 2, 4, 6], 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.75,
          ),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.75),
          buildTrack("track-vocals", "drums", clap, [3, 7], 0.9),
        ],
      },
    ];

    // Signature: chorus on every cell for synthwave shimmer. Breakdown
    // (cell 4) and vocal moment (cell 7) add phaser for motion.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 7
          ? (["chorus", "phaser"] as const)
          : (["chorus"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 108);
  },
  { beatName: "neon pulse" },
);

// ----- Composer #2: Four-on-the-Floor — house-inspired 124 bpm ---------

const fourOnFloorDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const openhat = pickByCategory(byKind.drums, "openhat");
    const clap = pickByCategory(byKind.drums, "clap");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 2) ?? bassA;
    const stab = pickOrNull(byKind.fx, 0);
    const stabB = pickOrNull(byKind.fx, 3) ?? stab;
    const vocalA = pickOrNull(byKind.vocals, 0);

    // All cells share the four-on-the-floor foundation (kick on every
    // downbeat); variation comes from top layer + bass figure + stabs.
    const four = [0, 2, 4, 6];
    const clapBeat = [2, 6];
    const off = [1, 3, 5, 7];

    const cellDefs = [
      // Cell 0 — Straight 4x4 kick + hats
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "drums", hihat, off, 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bassline + offbeat open hats
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack("track-guitar", "drums", openhat, off, 0.55),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Clap on 2 & 4, syncopated hat
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack("track-guitar", "drums", clap, clapBeat, 0.85),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.5),
        ],
      },
      // Cell 3 — Pump: snare fill + busy bass
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.7,
          ),
          buildTrack("track-guitar", "drums", snare, clapBeat, 0.85),
          buildTrack("track-vocals", "drums", openhat, off, 0.55),
        ],
      },
      // Cell 4 — Stab riff
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, [0, 3, 4, 7], 0.7),
          buildTrack("track-guitar", "fx", stab, [0, 3, 4, 7], 0.8),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.8),
        ],
      },
      // Cell 5 — Break: no kick, vocal hit
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", clap, clapBeat, 0.85),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.55),
          buildTrack("track-guitar", "fx", stab, [2, 6], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.9),
        ],
      },
      // Cell 6 — Pump back in
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack("track-bass", "bass", bassA, four, 0.75),
          buildTrack("track-guitar", "fx", stabB, [1, 5], 0.75),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.9),
        ],
      },
      // Cell 7 — Layered top: hat + stab
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack(
            "track-guitar",
            "drums",
            hihat,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.5,
          ),
          buildTrack("track-vocals", "fx", stab, [0, 2, 4, 6], 0.7),
        ],
      },
      // Cell 8 — Full flight
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.8,
          ),
          buildTrack("track-guitar", "fx", stabB, [0, 2, 4, 6], 0.8),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.95),
        ],
      },
    ];

    // Signature: moogFilter for that classic house filter pump. Sweep
    // cells (2, 3, 5) narrow the cutoff for build tension.
    const cellsWithSignature = cellDefs.map((def, i) => {
      const isSweep = i === 2 || i === 3 || i === 5;
      return {
        ...def,
        enabledEffects: isSweep ? (["moogFilter"] as const) : ([] as const),
      };
    });
    return assembleMatrix(cellsWithSignature, 124);
  },
  { beatName: "four on the floor" },
);

// ----- Composer #3: Lo-Fi Trap — slow 80 bpm vibe ---------------------

const lofiTrapDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const perc = pickByCategory(byKind.drums, "perc");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 2) ?? vocalA;
    const fxA = pickOrNull(byKind.fx, 0);
    const fxB = pickOrNull(byKind.fx, 2) ?? fxA;

    // Trap uses dotted / syncopated kick placement + rolled hats. We
    // simulate rolls inside 8 steps with consecutive hits at reduced
    // velocity.
    const trapKick = [0, 3, 6];
    const doubleTimeHat = [0, 1, 2, 3, 4, 5, 6, 7];
    const snareBackbeat = [2, 6];

    const cellDefs = [
      // Cell 0 — Vinyl-tape intro: sparse perc
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", perc, [2, 6], 0.6),
          buildTrack("track-bass", "fx", fxA, [0, 4], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Enter kick
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "drums", perc, [2, 6], 0.55),
          buildTrack("track-guitar", "fx", fxA, [0, 4], 0.5),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Bass enters, sparse snare
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.75),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.4),
        ],
      },
      // Cell 3 — Hi-hat rolls (double-time hat)
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.8),
          buildTrack("track-vocals", "drums", hihat, doubleTimeHat, 0.45, {
            0: 0.8,
            1: 0.4,
            2: 0.8,
            3: 0.4,
            4: 0.8,
            5: 0.4,
            6: 0.8,
            7: 0.4,
          }),
        ],
      },
      // Cell 4 — Melody moment: guitar
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 6], 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.6),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.7),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.4),
        ],
      },
      // Cell 5 — Vocal chop
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.8),
          buildTrack("track-vocals", "vocals", vocalA, [1, 5], 0.9),
        ],
      },
      // Cell 6 — Breakdown: all stops but perc + pad
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", perc, [1, 4, 6], 0.6),
          buildTrack("track-bass", "fx", fxB, [0, 4], 0.55),
          buildTrack("track-guitar", "guitar", guitarA, [0], 0.7),
          buildTrack("track-vocals", "vocals", vocalB, [4], 0.85),
        ],
      },
      // Cell 7 — Return with full rhythm + vocal
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.9),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.7),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.85),
          buildTrack("track-vocals", "vocals", vocalA, [2, 6], 0.9),
        ],
      },
      // Cell 8 — Outro fade
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0], 0.7),
          buildTrack("track-bass", "bass", bassA, [0], 0.5),
          buildTrack("track-guitar", "guitar", guitarA, [0], 0.6),
          buildTrack("track-vocals", "drums", perc, [2, 4, 6], 0.5),
        ],
      },
    ];

    // Signature: tremolo for that washed, cassette-warbling quality.
    // Melody cells (4, 5) stack chorus for thicker vocal chops.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 5
          ? (["tremolo", "chorus"] as const)
          : (["tremolo"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 80);
  },
  { beatName: "lo-fi trap" },
);

// ----- Composer #4: Boom-Bap — 90bpm head-nodder with swing ------------

const boomBapDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const openhat = pickByCategory(byKind.drums, "openhat");
    const perc = pickByCategory(byKind.drums, "perc");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 3) ?? bassA;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 3) ?? vocalA;

    // Classic boom-bap: kick-and-snare on the 1/3 (really 0, 2, 5 in 8-step),
    // hats on the quarters, bass reinforcing the kick with a walking shape.
    const kickPattern = [0, 5];
    const snarePattern = [2, 6];
    const hatQuarters = [0, 2, 4, 6];

    const cellDefs = [
      // Cell 0 — Head: sparse drums only
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "drums", hihat, hatQuarters, 0.55),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bass walk
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", hihat, hatQuarters, 0.55),
        ],
      },
      // Cell 2 — Off-beat hats for swing
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.5),
        ],
      },
      // Cell 3 — Vocal chop lands
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.85),
        ],
      },
      // Cell 4 — Guitar loop over drums
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.75),
          buildTrack("track-vocals", "drums", hihat, hatQuarters, 0.55),
        ],
      },
      // Cell 5 — Stripped: just kick + perc + vocal fill
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4], 0.85),
          buildTrack("track-bass", "drums", perc, [2, 6], 0.65),
          buildTrack("track-guitar", "bass", bassB, [0, 4], 0.55),
          buildTrack("track-vocals", "vocals", vocalB, [1, 3, 5, 7], 0.8),
        ],
      },
      // Cell 6 — Full rhythm with open-hat accents
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", openhat, [3, 7], 0.7),
        ],
      },
      // Cell 7 — Vocal + guitar layered moment
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "guitar", guitarA, [0, 4], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [2, 6], 0.85),
        ],
      },
      // Cell 8 — Outro: final snare hit with vocal tag
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0], 0.85),
          buildTrack("track-bass", "drums", snare, [2, 4], 0.9),
          buildTrack("track-guitar", "bass", bassB, [0], 0.6),
          buildTrack("track-vocals", "vocals", vocalB, [6], 0.9),
        ],
      },
    ];

    // Signature: chorus on the melodic cells for warmth, subtle moogFilter
    // throughout for that lo-fi sample-rate quality typical of 90s hip-hop.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 7
          ? (["chorus", "moogFilter"] as const)
          : (["moogFilter"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 90);
  },
  { beatName: "boom-bap" },
);

// Rotating list of composers. Each click of the "seed demo" button
// advances `demoIndex` (module-scoped) so users cycle through all
// variants before landing back on the first.
interface DemoComposer {
  (byKind: SamplesByKind): ProjectMatrix;
  beatName: string;
}
const DEMO_COMPOSERS: DemoComposer[] = [
  neonPulseDemo,
  fourOnFloorDemo,
  lofiTrapDemo,
  boomBapDemo,
];
let demoIndex = 0;

// Exported so projectSlice can build a v2 payload from current store state
// without duplicating the pattern→cell mapping here.
export function buildMatrixFromPatternAndMatrix(
  pattern: Pattern,
  matrix: ProjectMatrix,
  selectedCellId: string,
): ProjectMatrix {
  const cellIndex = matrix.cells.findIndex((c) => c.id === selectedCellId);
  const updatedCells: MixerCell[] =
    cellIndex >= 0
      ? matrix.cells.map((c, i) =>
          i === cellIndex
            ? {
                ...c,
                pattern: {
                  stepCount: pattern.stepCount,
                  tracks: pattern.tracks,
                },
                effects: pattern.effects,
              }
            : c,
        )
      : matrix.cells;
  return {
    schemaVersion: 2,
    sharedBpm: pattern.bpm,
    masterGain: pattern.masterGain,
    cells:
      updatedCells.length === MATRIX_CELL_COUNT
        ? updatedCells
        : [
            ...updatedCells,
            ...Array.from(
              { length: MATRIX_CELL_COUNT - updatedCells.length },
              (_, i) => createEmptyMixerCell(`c${updatedCells.length + i}`),
            ),
          ],
  };
}
