import type { StateCreator } from "zustand";
import { produce } from "immer";
import type { Pattern, EffectKind } from "@beats/shared";
import { BPM_MAX, BPM_MIN, createDefaultPattern } from "@beats/shared";

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
  setTrackGain: (trackId: string, gain: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  setBpm: (bpm: number) => void;
  setMasterGain: (gain: number) => void;
  setEffectParam: (kind: EffectKind, key: string, value: number) => void;
  toggleEffect: (kind: EffectKind) => void;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export const createPatternSlice: StateCreator<
  PatternSlice,
  [],
  [],
  PatternSlice
> = (set) => ({
  pattern: createDefaultPattern(),

  resetPattern: () => set({ pattern: createDefaultPattern() }),

  setPattern: (pattern) => set({ pattern }),

  toggleStep: (trackId, stepIndex) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        const step = track.steps[stepIndex];
        if (!step) return;
        step.active = !step.active;
      }),
    })),

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
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        track.sampleId = sampleId;
        track.sampleVersion = sampleVersion;
      }),
    })),

  setTrackGain: (trackId, gain) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        track.gain = clamp(gain, 0, 1);
      }),
    })),

  toggleMute: (trackId) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        track.muted = !track.muted;
      }),
    })),

  toggleSolo: (trackId) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track) return;
        track.soloed = !track.soloed;
      }),
    })),

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
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const effect = p.effects.find((e) => e.kind === kind);
        if (!effect) return;
        effect.enabled = !effect.enabled;
      }),
    })),
});
