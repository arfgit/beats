import type { StateCreator } from "zustand";
import type { PresenceState } from "@/lib/presence";
import {
  clearPresence,
  pickPeerColor,
  subscribeToPresence,
  writePresence,
} from "@/lib/presence";
import type { BeatsStore } from "./useBeatsStore";

export interface CollabSlice {
  collab: {
    peers: PresenceState[];
    focused: { trackId: string | null; step: number | null };
    unsubscribe: (() => void) | null;
    heartbeat: ReturnType<typeof setInterval> | null;
    activeProjectId: string | null;
  };
  startCollab: (projectId: string) => void;
  stopCollab: () => void;
  focusCell: (trackId: string | null, step: number | null) => void;
}

const HEARTBEAT_MS = 3000;

export const createCollabSlice: StateCreator<
  BeatsStore,
  [],
  [],
  CollabSlice
> = (set, get) => ({
  collab: {
    peers: [],
    focused: { trackId: null, step: null },
    unsubscribe: null,
    heartbeat: null,
    activeProjectId: null,
  },

  startCollab: (projectId) => {
    const user = get().auth.user;
    if (!user) return;
    get().stopCollab();

    const pushSelf = () => {
      const focused = get().collab.focused;
      void writePresence(projectId, {
        uid: user.id,
        displayName: user.displayName,
        color: pickPeerColor(user.id),
        focusedTrackId: focused.trackId,
        focusedStep: focused.step,
        updatedAt: Date.now(),
      });
    };

    const unsub = subscribeToPresence(projectId, user.id, (peers) => {
      set((s) => ({ collab: { ...s.collab, peers } }));
    });

    pushSelf();
    const heartbeat = setInterval(pushSelf, HEARTBEAT_MS);

    set((s) => ({
      collab: {
        ...s.collab,
        unsubscribe: unsub,
        heartbeat,
        activeProjectId: projectId,
      },
    }));
  },

  stopCollab: () => {
    const user = get().auth.user;
    const state = get().collab;
    state.unsubscribe?.();
    if (state.heartbeat) clearInterval(state.heartbeat);
    if (user && state.activeProjectId) {
      void clearPresence(state.activeProjectId, user.id);
    }
    set((s) => ({
      collab: {
        ...s.collab,
        peers: [],
        unsubscribe: null,
        heartbeat: null,
        activeProjectId: null,
      },
    }));
  },

  focusCell: (trackId, step) => {
    set((s) => ({ collab: { ...s.collab, focused: { trackId, step } } }));
  },
});
