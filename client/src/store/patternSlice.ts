import type { StateCreator } from "zustand";
import { produce } from "immer";
import type { Pattern, EffectKind } from "@beats/shared";
import { BPM_MAX, BPM_MIN, createDefaultPattern } from "@beats/shared";
import { recordCommand, type CommandHistorySlice } from "./commandHistorySlice";

export interface PatternSlice {
  pattern: Pattern;
  resetPattern: () => void;
  setPattern: (pattern: Pattern) => void;
  toggleStep: (trackId: string, stepIndex: number) => void;
  setStepVelocity: (
    trackId: string,
    stepIndex: number,
    velocity: number,
  ) => void;
  setTrackSample: (
    trackId: string,
    sampleId: string,
    sampleVersion: number,
  ) => void;
  /** Rename a track — empty string clears back to the kind default. */
  setTrackName: (trackId: string, name: string) => void;
  setTrackGain: (trackId: string, gain: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  setBpm: (bpm: number) => void;
  setMasterGain: (gain: number) => void;
  setEffectParam: (kind: EffectKind, key: string, value: number) => void;
  toggleEffect: (kind: EffectKind) => void;
  /** Deactivate every step on every track of the current pattern. */
  clearAllSteps: () => void;
  /** Activate (or deactivate) every step on a single track. */
  setAllStepsOnTrack: (trackId: string, active: boolean) => void;
  /** Reset gain/mute/solo on one track to defaults. */
  resetTrackMixer: (trackId: string) => void;
  /** Remove the sample assignment from one track. */
  clearTrackSample: (trackId: string) => void;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * Discrete user actions go through `recordCommand` so they participate in
 * undo/redo. Continuous-knob changes (bpm, gain, effect params) update the
 * pattern directly without polluting history — a Phase 3 refinement could
 * add coalescing if users want to undo a knob turn.
 */
export const createPatternSlice: StateCreator<
  PatternSlice & CommandHistorySlice,
  [],
  [],
  PatternSlice
> = (set, get) => ({
  pattern: createDefaultPattern(),

  resetPattern: () => set({ pattern: createDefaultPattern() }),

  setPattern: (pattern) => set({ pattern }),

  toggleStep: (trackId, stepIndex) =>
    recordCommand(get, set, "toggle step", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      const step = track?.steps[stepIndex];
      if (step) step.active = !step.active;
    }),

  setStepVelocity: (trackId, stepIndex, velocity) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        const step = track?.steps[stepIndex];
        if (!step) return;
        step.velocity = clamp(velocity, 0, 1);
      }),
    })),

  setTrackSample: (trackId, sampleId, sampleVersion) =>
    recordCommand(get, set, "set sample", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (!track) return;
      track.sampleId = sampleId;
      track.sampleVersion = sampleVersion;
    }),

  setTrackName: (trackId, name) =>
    recordCommand(get, set, "rename track", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        delete track.name;
      } else {
        track.name = trimmed.slice(0, 40);
      }
    }),

  setTrackGain: (trackId, gain) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        track.gain = clamp(gain, 0, 1);
      }),
    })),

  toggleMute: (trackId) =>
    recordCommand(get, set, "toggle mute", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (track) track.muted = !track.muted;
    }),

  toggleSolo: (trackId) =>
    recordCommand(get, set, "toggle solo", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (track) track.soloed = !track.soloed;
    }),

  setBpm: (bpm) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        p.bpm = clamp(Math.round(bpm), BPM_MIN, BPM_MAX);
      }),
    })),

  setMasterGain: (gain) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        p.masterGain = clamp(gain, 0, 1);
      }),
    })),

  setEffectParam: (kind, key, value) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const effect = p.effects.find((e) => e.kind === kind);
        if (!effect) return;
        effect.params[key] = value;
      }),
    })),

  toggleEffect: (kind) =>
    recordCommand(get, set, "toggle effect", (draft) => {
      const effect = draft.effects.find((e) => e.kind === kind);
      if (effect) effect.enabled = !effect.enabled;
    }),

  clearAllSteps: () =>
    recordCommand(get, set, "clear all steps", (draft) => {
      for (const track of draft.tracks) {
        for (const step of track.steps) step.active = false;
      }
    }),

  setAllStepsOnTrack: (trackId, active) =>
    recordCommand(
      get,
      set,
      active ? "select all steps" : "clear row steps",
      (draft) => {
        const track = draft.tracks.find((t) => t.id === trackId);
        if (!track) return;
        for (const step of track.steps) step.active = active;
      },
    ),

  resetTrackMixer: (trackId) =>
    recordCommand(get, set, "reset mixer", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (!track) return;
      track.gain = 0.8;
      track.muted = false;
      track.soloed = false;
    }),

  clearTrackSample: (trackId) =>
    recordCommand(get, set, "clear sample", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (!track) return;
      track.sampleId = null;
      track.sampleVersion = null;
    }),
});
