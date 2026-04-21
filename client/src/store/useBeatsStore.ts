import { create } from "zustand";
import { createAuthSlice, type AuthSlice } from "./authSlice";
import { createUiSlice, type UiSlice } from "./uiSlice";
import { createPatternSlice, type PatternSlice } from "./patternSlice";
import { createTransportSlice, type TransportSlice } from "./transportSlice";
import {
  createCommandHistorySlice,
  type CommandHistorySlice,
} from "./commandHistorySlice";
import { createProjectSlice, type ProjectSlice } from "./projectSlice";
import { createCollabSlice, type CollabSlice } from "./collabSlice";

export type BeatsStore = AuthSlice &
  UiSlice &
  PatternSlice &
  TransportSlice &
  CommandHistorySlice &
  ProjectSlice &
  CollabSlice;

export const useBeatsStore = create<BeatsStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createUiSlice(...a),
  ...createPatternSlice(...a),
  ...createTransportSlice(...a),
  ...createCommandHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createCollabSlice(...a),
}));

// Cross-slice glue: any pattern mutation → markDirty (when a project is loaded).
let previousPattern = useBeatsStore.getState().pattern;
useBeatsStore.subscribe((state) => {
  if (state.pattern !== previousPattern && state.project.current) {
    previousPattern = state.pattern;
    state.markDirty();
  } else if (state.pattern !== previousPattern) {
    previousPattern = state.pattern;
  }
});
