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
    /**
     * Monotonically-increasing counter that any modal can subscribe to
     * via useEffect. When something globally significant happens (e.g.
     * the user accepts a session invite from a toast and we want every
     * stale dialog to close out of their way), bumping this counter
     * gives modals a one-shot signal to call their own `onClose`.
     */
    popupCloseTrigger: number;
  };
  pushToast: (kind: ToastKind, message: string) => string;
  dismissToast: (id: string) => void;
  setTooltipsEnabled: (enabled: boolean) => void;
  /** Arm a sample for replace-on-click. Pass null to disarm. */
  armSample: (sampleId: string | null) => void;
  /** Bump the close-all-popups counter — every dialog watching it
   *  via useEffect should call its own onClose. */
  closeAllPopups: () => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  ui: {
    toasts: [],
    tooltipsEnabled: true,
    armedSampleId: null,
    popupCloseTrigger: 0,
  },

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

  closeAllPopups: () =>
    set((s) => ({
      ui: { ...s.ui, popupCloseTrigger: s.ui.popupCloseTrigger + 1 },
    })),
});
