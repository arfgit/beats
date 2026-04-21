import { create } from "zustand";
import { createAuthSlice, type AuthSlice } from "./authSlice";
import { createUiSlice, type UiSlice } from "./uiSlice";

export type BeatsStore = AuthSlice & UiSlice;

export const useBeatsStore = create<BeatsStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createUiSlice(...a),
}));
