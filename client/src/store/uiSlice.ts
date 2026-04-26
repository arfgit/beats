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
    /**
     * Id of the sample currently "armed" for replace-on-click. When set,
     * clicking a step in the grid replaces that step's sample instead of
     * the usual toggle-active behavior. Null when no sample is armed.
     */
    armedSampleId: string | null;
  };
  pushToast: (kind: ToastKind, message: string) => string;
  dismissToast: (id: string) => void;
  setTooltipsEnabled: (enabled: boolean) => void;
  /** Arm a sample for replace-on-click. Pass null to disarm. */
  armSample: (sampleId: string | null) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  ui: { toasts: [], tooltipsEnabled: true, armedSampleId: null },

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

  armSample: (sampleId) =>
    set((s) => ({ ui: { ...s.ui, armedSampleId: sampleId } })),
});
