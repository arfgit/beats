import type { StateCreator } from "zustand";
import { nanoid } from "nanoid";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface UiSlice {
  ui: {
    toasts: Toast[];
    tooltipsEnabled: boolean;
  };
  pushToast: (kind: ToastKind, message: string) => string;
  dismissToast: (id: string) => void;
  setTooltipsEnabled: (enabled: boolean) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  ui: { toasts: [], tooltipsEnabled: true },

  pushToast: (kind, message) => {
    const id = nanoid(8);
    set((s) => ({
      ui: { ...s.ui, toasts: [...s.ui.toasts, { id, kind, message }] },
    }));
    setTimeout(() => {
      set((s) => ({
        ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) },
      }));
    }, 4000);
    return id;
  },

  dismissToast: (id) =>
    set((s) => ({
      ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) },
    })),

  setTooltipsEnabled: (enabled) =>
    set((s) => ({ ui: { ...s.ui, tooltipsEnabled: enabled } })),
});
