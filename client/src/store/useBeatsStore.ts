import { create } from "zustand";
import { setSuspensionHandler } from "@/audio/context";
import { saveLocalCache } from "@/lib/localCache";
import { createAuthSlice, type AuthSlice } from "./authSlice";
import { createUiSlice, type UiSlice } from "./uiSlice";
import { createPatternSlice, type PatternSlice } from "./patternSlice";
import { createMatrixSlice, type MatrixSlice } from "./matrixSlice";
import { createTransportSlice, type TransportSlice } from "./transportSlice";
import {
  createCommandHistorySlice,
  type CommandHistorySlice,
} from "./commandHistorySlice";
import { createProjectSlice, type ProjectSlice } from "./projectSlice";
import { createCollabSlice, type CollabSlice } from "./collabSlice";
import { createSamplesSlice, type SamplesSlice } from "./samplesSlice";

export type BeatsStore = AuthSlice &
  UiSlice &
  PatternSlice &
  MatrixSlice &
  TransportSlice &
  CommandHistorySlice &
  ProjectSlice &
  CollabSlice &
  SamplesSlice;

export const useBeatsStore = create<BeatsStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createUiSlice(...a),
  ...createPatternSlice(...a),
  ...createMatrixSlice(...a),
  ...createTransportSlice(...a),
  ...createCommandHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createCollabSlice(...a),
  ...createSamplesSlice(...a),
}));

// Bridge audio/context visibility events into the transport slice so the
// UI can render a tap-to-resume affordance when the browser holds the
// AudioContext suspended after tab-switching back.
setSuspensionHandler((suspended) =>
  useBeatsStore.getState().setAudioSuspended(suspended),
);

// Cross-slice glue: any pattern mutation →
//   1. mirror into matrix.cells[selectedCellId] so the matrix transport
//      reads fresh data on every cell visit (without this, beats toggled
//      off mid-loop still play because the matrix still has the stale
//      step-active state)
//   2. markDirty when a project is loaded so autosave triggers
//
// The mirror runs BEFORE markDirty so a save that fires soon after sees
// the updated matrix. Skip both when `applyingRemote` is set — that's
// loadProject wholesale-replacing state and we don't want to bounce.
let previousPattern = useBeatsStore.getState().pattern;
useBeatsStore.subscribe((state) => {
  if (state.pattern === previousPattern) return;
  previousPattern = state.pattern;
  if (state.project.applyingRemote) return;

  // Mirror into matrix. Build a fresh cells[] so the matrix array has a
  // new reference — any downstream selectors watching `state.matrix`
  // correctly re-compute.
  const selectedId = state.selectedCellId;
  const selectedIdx = state.matrix.cells.findIndex((c) => c.id === selectedId);
  if (selectedIdx >= 0) {
    useBeatsStore.setState((s) => ({
      matrix: {
        ...s.matrix,
        sharedBpm: state.pattern.bpm,
        masterGain: state.pattern.masterGain,
        cells: s.matrix.cells.map((c, i) =>
          i === selectedIdx
            ? {
                ...c,
                pattern: {
                  stepCount: state.pattern.stepCount,
                  tracks: state.pattern.tracks,
                },
                effects: state.pattern.effects,
              }
            : c,
        ),
      },
    }));
  }

  if (state.project.current) state.markDirty();
});

// Local cache mirror: debounce-write matrix + selectedCellId to
// localStorage so a browser refresh doesn't vaporize active work. The
// cache is independent of Firestore autosave — it also covers anonymous
// sessions that never create a Project record. Skipped during
// `applyingRemote` so a loadProject / rehydrate doesn't bounce its own
// state back into the cache.
const CACHE_DEBOUNCE_MS = 300;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
let previousMatrix = useBeatsStore.getState().matrix;
let previousSelectedCellId = useBeatsStore.getState().selectedCellId;
useBeatsStore.subscribe((state) => {
  if (state.project.applyingRemote) return;
  if (
    state.matrix === previousMatrix &&
    state.selectedCellId === previousSelectedCellId
  ) {
    return;
  }
  previousMatrix = state.matrix;
  previousSelectedCellId = state.selectedCellId;
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    saveLocalCache(state.matrix, state.selectedCellId);
  }, CACHE_DEBOUNCE_MS);
});
