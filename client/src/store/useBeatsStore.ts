import { create } from "zustand";
import { createAuthSlice, type AuthSlice } from "./authSlice";
import { createUiSlice, type UiSlice } from "./uiSlice";
import { createPatternSlice, type PatternSlice } from "./patternSlice";
import { createTransportSlice, type TransportSlice } from "./transportSlice";

export type BeatsStore = AuthSlice & UiSlice & PatternSlice & TransportSlice;

export const useBeatsStore = create<BeatsStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createUiSlice(...a),
  ...createPatternSlice(...a),
  ...createTransportSlice(...a),
}));
