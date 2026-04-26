import type { StateCreator } from "zustand";
import { produce } from "immer";
import type { Pattern, EffectKind, SampleRef } from "@beats/shared";
import { BPM_MAX, BPM_MIN, createDefaultPattern } from "@beats/shared";
import { recordCommand } from "./commandHistorySlice";
import { snapshotForStep, snapshotForTrack } from "./sampleSnapshot";
import type { BeatsStore } from "./useBeatsStore";

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
  /**
   * Replace the sample on a single step in place — does not touch sibling
   * steps or the track-level default. If the step is currently inactive,
   * it is also activated (drop-to-place semantics for armed-sample mode).
   */
  setStepSample: (
    trackId: string,
    stepIndex: number,
    sampleId: string,
    sampleVersion: number,
  ) => void;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * Discrete user actions go through `recordCommand` so they participate in
 * undo/redo. Continuous-knob changes (bpm, gain, effect params) update the
 * pattern directly without polluting history — a Phase 3 refinement could
 * add coalescing if users want to undo a knob turn.
 */
// Resolves a sample by id from the live samples slice. Pattern slice
// actions need this to pin `sampleName` at write time without forcing
// every caller to look up the SampleRef themselves. Returns null when
// the lookup misses (sample not yet hydrated, deleted, etc.) — pinning
// `null` keeps the field present and explicit rather than ambiguous.
function lookupSample(
  get: () => BeatsStore,
  id: string | null,
): SampleRef | null {
  if (!id) return null;
  return get().findSampleById(id) ?? null;
}

export const createPatternSlice: StateCreator<
  BeatsStore,
  [],
  [],
  PatternSlice
> = (set, get) => ({
  pattern: createDefaultPattern(),

  resetPattern: () => set({ pattern: createDefaultPattern() }),

  setPattern: (pattern) => set({ pattern }),

  toggleStep: (trackId, stepIndex) => {
    // Resolve the track's current sample BEFORE entering the recorder
    // so we can pin the canonical `name` from SampleRef (recordCommand
    // only exposes the pattern draft, not the full store).
    const trackBefore = get().pattern.tracks.find((t) => t.id === trackId);
    const sample = lookupSample(get, trackBefore?.sampleId ?? null);
    recordCommand(get, set, "toggle step", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      const step = track?.steps[stepIndex];
      if (!track || !step) return;
      const willBeActive = !step.active;
      step.active = willBeActive;
      if (willBeActive) {
        // Snapshot the row's current sample (id, version, name) onto the
        // step so a later sample swap on the row doesn't retroactively
        // change what this step plays — each step remembers the marker it
        // was placed with. Prefer the live SampleRef.name; fall back to
        // the track's already-pinned name when samples haven't hydrated.
        if (sample) {
          const snap = snapshotForStep(sample);
          step.sampleId = snap.sampleId;
          step.sampleVersion = snap.sampleVersion;
          step.sampleName = snap.sampleName;
        } else if (track.sampleId && track.sampleVersion != null) {
          step.sampleId = track.sampleId;
          step.sampleVersion = track.sampleVersion;
          step.sampleName = track.sampleName ?? null;
        }
      } else {
        // On deactivate, clear the marker so a subsequent re-click picks
        // up whatever the row currently points at (avoids stale markers
        // on empty steps).
        delete step.sampleId;
        delete step.sampleVersion;
        delete step.sampleName;
      }
    });
  },

  setStepVelocity: (trackId, stepIndex, velocity) =>
    set((s) => ({
      pattern: produce(s.pattern, (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        const step = track?.steps[stepIndex];
        if (!step) return;
        step.velocity = clamp(velocity, 0, 1);
      }),
    })),

  setTrackSample: (trackId, sampleId, sampleVersion) => {
    // Look up the SampleRef for its canonical name BEFORE the recorder.
    // Pinning the name on the track means future toggles on this row
    // can copy it to steps even if the samples slice is later cleared.
    const sample = lookupSample(get, sampleId);
    recordCommand(get, set, "set sample", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const snap = snapshotForTrack(sample);
      track.sampleId = sampleId;
      track.sampleVersion = sampleVersion;
      track.sampleName = snap.sampleName;
      // Deliberately do NOT rewrite existing steps' snapshots — each
      // step keeps the sample it was placed with. This is the contract
      // promised by the per-step snapshot fields.
    });
  },

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
        for (const step of track.steps) {
          step.active = false;
          delete step.sampleId;
          delete step.sampleVersion;
          delete step.sampleName;
        }
      }
    }),

  setAllStepsOnTrack: (trackId, active) => {
    // Resolve the track's current sample once (used to pin the name on
    // every step we're activating) before entering the recorder.
    const trackBefore = get().pattern.tracks.find((t) => t.id === trackId);
    const sample = lookupSample(get, trackBefore?.sampleId ?? null);
    recordCommand(
      get,
      set,
      active ? "select all steps" : "clear row steps",
      (draft) => {
        const track = draft.tracks.find((t) => t.id === trackId);
        if (!track) return;
        for (const step of track.steps) {
          step.active = active;
          if (active && track.sampleId && track.sampleVersion != null) {
            step.sampleId = track.sampleId;
            step.sampleVersion = track.sampleVersion;
            step.sampleName = sample?.name ?? track.sampleName ?? null;
          } else if (!active) {
            delete step.sampleId;
            delete step.sampleVersion;
            delete step.sampleName;
          }
        }
      },
    );
  },

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
      track.sampleName = null;
      // Deactivate all steps and strip their pinned samples so the row is
      // fully blank — leaving active steps with no track sample leaves them
      // unclickable (hasSample=false) but still visually lit, which is
      // confusing. A full clear matches what the user expects.
      for (const step of track.steps) {
        step.active = false;
        delete step.sampleId;
        delete step.sampleVersion;
        delete step.sampleName;
      }
    }),

  setStepSample: (trackId, stepIndex, sampleId, sampleVersion) => {
    // Look up the canonical SampleRef so we can pin the name. If the
    // lookup misses, the step still gets the correct id/version pair —
    // label falls back to the live lookup (or "missing") at render.
    const sample = lookupSample(get, sampleId);
    recordCommand(get, set, "replace step sample", (draft) => {
      const track = draft.tracks.find((t) => t.id === trackId);
      const step = track?.steps[stepIndex];
      if (!track || !step) return;
      // Activate-on-place: dropping a sample on an inactive step
      // implicitly turns the step on. Matches user expectation that
      // placing a sample = "I want this to play here."
      step.active = true;
      step.sampleId = sampleId;
      step.sampleVersion = sampleVersion;
      step.sampleName = sample?.name ?? null;
    });
  },
});
