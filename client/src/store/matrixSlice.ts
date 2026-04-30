import type { StateCreator } from "zustand";
import { produce } from "immer";
import type {
  EditOp,
  MixerCell,
  Pattern,
  ProjectMatrix,
  TrackKind,
} from "@beats/shared";
import {
  BPM_MAX,
  BPM_MIN,
  createDefaultMatrix,
  createEmptyMixerCell,
  createEmptyTrack,
  MATRIX_CELL_COUNT,
  TRACK_KINDS,
} from "@beats/shared";
import { composeNextDemoBeat, type SamplesByKind } from "./demoBeats";
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

  /**
   * Apply a remote `EditOp` directly to the matrix, targeting the cell
   * named in `op.cellId` regardless of which cell the local user has
   * selected. Refreshes the flat pattern only if the affected cell is
   * the one currently being edited so the row grid reflects the change.
   *
   * This bypasses the per-slice action dispatch used for local edits —
   * those actions mutate the flat `pattern` (the working copy of the
   * selected cell) and would land remote ops on the wrong cell when
   * the local selection differs from `op.cellId`.
   */
  applyRemoteEditOp: (op: EditOp) => void;

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
      // Broadcast the new focus to peers so the cell-highlight overlay
      // on the matrix grid actually has data. Without this, peers see
      // each other's cursors but can't tell which cell anyone is on.
      get().focusCell(id, null, null);
    },

    setActiveCellId: (id) => {
      set({ activeCellId: id });
    },

    toggleCellEnabled: (cellId) => {
      let nextEnabled = false;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (cell) {
            cell.enabled = !cell.enabled;
            nextEnabled = cell.enabled;
          }
        }),
      }));
      get().emitEdit({
        kind: "cell/setEnabled",
        cellId,
        enabled: nextEnabled,
      });
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
      get().emitEdit({ kind: "cell/reorder", fromIndex, toIndex });
    },

    reorderTracks: (cellId, fromIndex, toIndex) => {
      let didReorder = false;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          const max = cell.pattern.tracks.length - 1;
          if (fromIndex < 0 || fromIndex > max) return;
          if (toIndex < 0 || toIndex > max) return;
          if (fromIndex === toIndex) return;
          const [moved] = cell.pattern.tracks.splice(fromIndex, 1);
          if (moved) {
            cell.pattern.tracks.splice(toIndex, 0, moved);
            didReorder = true;
          }
        }),
      }));
      if (didReorder) {
        get().emitEdit({
          kind: "track/reorder",
          cellId,
          fromIndex,
          toIndex,
        });
      }
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
      // Broadcast the full track payload — peers need the same id +
      // step shape so subsequent step-toggle ops on this trackId
      // resolve. Without this, an addTrack on the host produces a
      // trackId the invitees don't have, and every later edit on
      // that row silently no-ops on the invitee side.
      get().emitEdit({ kind: "track/add", cellId, track });
    },

    removeTrack: (cellId, trackId) => {
      let didRemove = false;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          const cell = draft.cells.find((c) => c.id === cellId);
          if (!cell) return;
          if (cell.pattern.tracks.length <= 1) return;
          const before = cell.pattern.tracks.length;
          cell.pattern.tracks = cell.pattern.tracks.filter(
            (t) => t.id !== trackId,
          );
          didRemove = cell.pattern.tracks.length !== before;
        }),
      }));
      if (didRemove) {
        get().emitEdit({ kind: "track/remove", cellId, trackId });
      }
    },

    clearAllCellSteps: () => {
      const cellIds = get().matrix.cells.map((c) => c.id);
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
      // Broadcast the wipe so peers in a live session see it. Fan out
      // one op per cell using the existing pattern/clearAllSteps op
      // rather than introducing a new bulk EditOp — keeps the apply
      // path identical between host and remote peers.
      for (const cellId of cellIds) {
        get().emitEdit({ kind: "pattern/clearAllSteps", cellId });
      }
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
      get().emitEdit({
        kind: "cell/setName",
        cellId,
        name: name.trim().slice(0, 24),
      });
    },

    toggleAllCellsEnabled: () => {
      // Smart semantics: if any cell is currently enabled, disable all.
      // Otherwise, enable all. Flipping each independently is confusing
      // when the matrix starts with cell 0 enabled by default — the
      // first click would leave the user with "every cell except the
      // first," which nobody asks for.
      const cells = get().matrix.cells;
      const anyEnabled = cells.some((c) => c.enabled);
      const next = !anyEnabled;
      const cellIds = cells.map((c) => c.id);
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          for (const cell of draft.cells) cell.enabled = next;
        }),
      }));
      // Broadcast so live-session peers see the bulk flip. Per-cell op
      // re-uses the existing cell/setEnabled apply path.
      for (const cellId of cellIds) {
        get().emitEdit({ kind: "cell/setEnabled", cellId, enabled: next });
      }
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
      get().emitEdit({
        kind: "track/setKind",
        cellId,
        trackId,
        newKind: kind,
      });
    },

    applyRemoteEditOp: (op) => {
      const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
      let touchedCellId: string | null = null;
      // Pattern-level ops (bpm, masterGain) target the matrix root —
      // tracked as "touched" without a cell so we still refresh the
      // flat pattern for the selected cell at the end.
      let touchedShared = false;
      set((s) => ({
        matrix: produce(s.matrix, (draft) => {
          switch (op.kind) {
            case "matrix/toggleStep": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              const step = track?.steps[op.step];
              if (!cell || !track || !step) return;
              const willBeActive = !step.active;
              step.active = willBeActive;
              if (willBeActive) {
                if (track.sampleId && track.sampleVersion != null) {
                  step.sampleId = track.sampleId;
                  step.sampleVersion = track.sampleVersion;
                  step.sampleName = track.sampleName ?? null;
                }
              } else {
                delete step.sampleId;
                delete step.sampleVersion;
                delete step.sampleName;
              }
              touchedCellId = op.cellId;
              return;
            }
            case "matrix/setStepVelocity": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const step = cell?.pattern.tracks.find((t) => t.id === op.trackId)
                ?.steps[op.step];
              if (!step) return;
              step.velocity = clamp01(op.velocity);
              touchedCellId = op.cellId;
              return;
            }
            case "matrix/setStepSample": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const step = cell?.pattern.tracks.find((t) => t.id === op.trackId)
                ?.steps[op.step];
              if (!step) return;
              step.sampleId = op.sampleId;
              step.sampleVersion = op.sampleVersion;
              step.sampleName = op.sampleName ?? null;
              touchedCellId = op.cellId;
              return;
            }
            case "track/setSample": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.sampleId = op.sampleId;
              track.sampleVersion = op.sampleVersion;
              track.sampleName = op.sampleName ?? null;
              touchedCellId = op.cellId;
              return;
            }
            case "track/setName": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              const trimmed = op.name.trim();
              if (trimmed.length === 0) {
                delete track.name;
              } else {
                track.name = trimmed.slice(0, 40);
              }
              touchedCellId = op.cellId;
              return;
            }
            case "track/setGain": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.gain = clamp01(op.gain);
              touchedCellId = op.cellId;
              return;
            }
            case "track/toggleMute": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.muted = !track.muted;
              touchedCellId = op.cellId;
              return;
            }
            case "track/toggleSolo": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.soloed = !track.soloed;
              touchedCellId = op.cellId;
              return;
            }
            case "track/setKind": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              if (track.kind === op.newKind) return;
              track.kind = op.newKind;
              track.sampleId = null;
              track.sampleVersion = null;
              for (const step of track.steps) {
                step.active = false;
                step.velocity = 1;
              }
              touchedCellId = op.cellId;
              return;
            }
            case "track/clearSample": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.sampleId = null;
              track.sampleVersion = null;
              track.sampleName = null;
              // Match the local clearTrackSample behavior: deactivate
              // every step on the row and strip per-step sample
              // snapshots. Without this, peers were left with lit
              // steps that had no sample to play — visually wrong
              // and audibly silent.
              for (const step of track.steps) {
                step.active = false;
                delete step.sampleId;
                delete step.sampleVersion;
                delete step.sampleName;
              }
              touchedCellId = op.cellId;
              return;
            }
            case "track/setAllSteps": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              // When activating, mirror the local setAllStepsOnTrack
              // behavior of pinning the row's current sample onto
              // each newly-active step. Without this, remote peers
              // see active steps with no sample snapshot and the
              // labels appear blank or stale.
              for (const step of track.steps) {
                step.active = op.active;
                if (op.active) {
                  if (track.sampleId && track.sampleVersion != null) {
                    step.sampleId = track.sampleId;
                    step.sampleVersion = track.sampleVersion;
                    step.sampleName = track.sampleName ?? null;
                  }
                } else {
                  delete step.sampleId;
                  delete step.sampleVersion;
                  delete step.sampleName;
                }
              }
              touchedCellId = op.cellId;
              return;
            }
            case "track/resetMixer": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const track = cell?.pattern.tracks.find(
                (t) => t.id === op.trackId,
              );
              if (!track) return;
              track.gain = 0.8;
              track.muted = false;
              track.soloed = false;
              touchedCellId = op.cellId;
              return;
            }
            case "pattern/setBpm": {
              draft.sharedBpm = Math.max(
                BPM_MIN,
                Math.min(BPM_MAX, Math.round(op.bpm)),
              );
              touchedShared = true;
              return;
            }
            case "pattern/setMasterGain": {
              draft.masterGain = clamp01(op.gain);
              touchedShared = true;
              return;
            }
            case "pattern/setEffectParam": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const effect = cell?.effects.find(
                (e) => e.kind === op.effectKind,
              );
              if (!effect) return;
              (effect.params as Record<string, number>)[op.key] = op.value;
              touchedCellId = op.cellId;
              return;
            }
            case "pattern/toggleEffect": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              const effect = cell?.effects.find(
                (e) => e.kind === op.effectKind,
              );
              if (!effect) return;
              effect.enabled = !effect.enabled;
              touchedCellId = op.cellId;
              return;
            }
            case "pattern/clearAllSteps": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              for (const track of cell.pattern.tracks) {
                for (const step of track.steps) step.active = false;
              }
              touchedCellId = op.cellId;
              return;
            }
            case "cell/setEnabled": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              // Use the explicit value from the op rather than toggling —
              // host disabling a cell that's already disabled on this
              // peer should stay disabled, not flip back on.
              cell.enabled = op.enabled;
              return;
            }
            case "cell/setName": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              const trimmed = op.name.trim();
              if (trimmed.length === 0) {
                delete cell.name;
              } else {
                cell.name = trimmed.slice(0, 24);
              }
              return;
            }
            case "track/add": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              // Idempotency guard: if the trackId already exists on
              // this peer (rare race during reconnect/resync), skip.
              if (cell.pattern.tracks.some((t) => t.id === op.track.id)) return;
              cell.pattern.tracks.push(op.track);
              touchedCellId = op.cellId;
              return;
            }
            case "track/remove": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              if (cell.pattern.tracks.length <= 1) return;
              cell.pattern.tracks = cell.pattern.tracks.filter(
                (t) => t.id !== op.trackId,
              );
              touchedCellId = op.cellId;
              return;
            }
            case "track/reorder": {
              const cell = draft.cells.find((c) => c.id === op.cellId);
              if (!cell) return;
              const max = cell.pattern.tracks.length - 1;
              if (op.fromIndex < 0 || op.fromIndex > max) return;
              if (op.toIndex < 0 || op.toIndex > max) return;
              if (op.fromIndex === op.toIndex) return;
              const [moved] = cell.pattern.tracks.splice(op.fromIndex, 1);
              if (moved) cell.pattern.tracks.splice(op.toIndex, 0, moved);
              touchedCellId = op.cellId;
              return;
            }
            case "cell/reorder": {
              const max = draft.cells.length - 1;
              if (op.fromIndex < 0 || op.fromIndex > max) return;
              if (op.toIndex < 0 || op.toIndex > max) return;
              if (op.fromIndex === op.toIndex) return;
              const [moved] = draft.cells.splice(op.fromIndex, 1);
              if (moved) draft.cells.splice(op.toIndex, 0, moved);
              // Cell reorders re-arrange the matrix top-level — the
              // selected cell didn't change identity, so no flat-pattern
              // refresh needed. Leaving touchedCellId/touchedShared
              // unset is intentional.
              return;
            }
            case "transport/play":
            case "transport/stop": {
              // Transport ops are intercepted by collabSlice's apply
              // path and routed to the local play/stop actions — they
              // never reach this switch in practice. The cases are
              // here only to keep the exhaustiveness check happy.
              return;
            }
            default: {
              const _exhaustive: never = op;
              void _exhaustive;
              return;
            }
          }
        }),
      }));
      // If the affected cell is the one this peer is currently editing,
      // refresh the flat pattern so the row grid reflects the remote
      // change immediately. Pattern-level ops (bpm, masterGain) also
      // need the refresh so the transport bar updates.
      const selectedCellId = get().selectedCellId;
      if (
        touchedShared ||
        (touchedCellId && touchedCellId === selectedCellId)
      ) {
        get().loadCellIntoPattern(selectedCellId);
      }
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
      const { matrix, beatName } = composeNextDemoBeat(byKind);
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
      s.pushToast("success", `demo beat: ${beatName} — hit play`);
    },
  };
};

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
