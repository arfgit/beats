import type { StateCreator } from "zustand";
import { produce, enablePatches, applyPatches, type Patch } from "immer";
import type { Pattern } from "@beats/shared";

enablePatches();

export interface PatternCommand {
  label: string;
  forward: Patch[];
  inverse: Patch[];
}

const HISTORY_LIMIT = 100;

export interface CommandHistorySlice {
  history: {
    past: PatternCommand[];
    future: PatternCommand[];
  };
  pushCommand: (label: string, forward: Patch[], inverse: Patch[]) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

/**
 * Immer patch-based undo/redo. A command records both forward and inverse
 * patches on the Pattern, which can be replayed on redo and reversed on undo.
 */
export const createCommandHistorySlice: StateCreator<
  CommandHistorySlice & { pattern: Pattern; setPattern: (p: Pattern) => void },
  [],
  [],
  CommandHistorySlice
> = (set, get) => ({
  history: { past: [], future: [] },

  pushCommand: (label, forward, inverse) =>
    set((s) => {
      const past = [...s.history.past, { label, forward, inverse }];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { history: { past, future: [] } };
    }),

  undo: () => {
    const { past, future } = get().history;
    const last = past[past.length - 1];
    if (!last) return;
    const current = get().pattern;
    const restored = produce(current, (draft) =>
      applyPatches(draft, last.inverse),
    );
    set({
      pattern: restored,
      history: { past: past.slice(0, -1), future: [last, ...future] },
    });
  },

  redo: () => {
    const { past, future } = get().history;
    const next = future[0];
    if (!next) return;
    const current = get().pattern;
    const restored = produce(current, (draft) =>
      applyPatches(draft, next.forward),
    );
    set({
      pattern: restored,
      history: { past: [...past, next], future: future.slice(1) },
    });
  },

  clearHistory: () => set({ history: { past: [], future: [] } }),
});

/**
 * Helper that applies a mutator to the current pattern via Immer with patch
 * tracking enabled, then pushes the resulting command into history. Use this
 * for any user-originated pattern change that should be undoable.
 */
export function recordCommand<
  S extends {
    pattern: Pattern;
    pushCommand: CommandHistorySlice["pushCommand"];
    setPattern: (p: Pattern) => void;
  },
>(
  get: () => S,
  set: (partial: Partial<S>) => void,
  label: string,
  mutator: (draft: Pattern) => void,
): void {
  const prev = get().pattern;
  let forward: Patch[] = [];
  let inverse: Patch[] = [];
  const next = produce(
    prev,
    (draft) => {
      mutator(draft);
    },
    (patches, inversePatches) => {
      forward = patches;
      inverse = inversePatches;
    },
  );
  if (forward.length === 0) return;
  set({ pattern: next } as Partial<S>);
  get().pushCommand(label, forward, inverse);
}
