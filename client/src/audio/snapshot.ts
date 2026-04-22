import type {
  EffectKind,
  EffectState,
  Pattern,
  Track,
  TrackKind,
} from "@beats/shared";

export interface EngineStepSnapshot {
  active: boolean;
  velocity: number;
  /**
   * Sample this specific step should play. Null means fall back to
   * `track.sampleKey` — that's the "I haven't been placed since the
   * sample was picked" or "legacy step" case. The scheduler resolves
   * `step.sampleKey ?? track.sampleKey` before routing to a subvoice.
   */
  sampleKey: string | null;
}

export interface EngineTrackSnapshot {
  id: string;
  kind: TrackKind;
  sampleKey: string | null;
  gain: number;
  muted: boolean;
  soloed: boolean;
  steps: ReadonlyArray<EngineStepSnapshot>;
}

export interface EngineEffectSnapshot {
  kind: EffectKind;
  enabled: boolean;
  params: Readonly<Record<string, number>>;
}

export interface EnginePatternSnapshot {
  bpm: number;
  masterGain: number;
  stepCount: number;
  tracks: ReadonlyArray<EngineTrackSnapshot>;
  effects: ReadonlyArray<EngineEffectSnapshot>;
  anySoloed: boolean;
}

export function freezeSnapshot(pattern: Pattern): EnginePatternSnapshot {
  const anySoloed = pattern.tracks.some((t) => t.soloed);
  return {
    bpm: pattern.bpm,
    masterGain: pattern.masterGain,
    stepCount: pattern.stepCount,
    anySoloed,
    tracks: pattern.tracks.map(freezeTrack),
    effects: pattern.effects.map(freezeEffect),
  };
}

function freezeTrack(track: Track): EngineTrackSnapshot {
  return {
    id: track.id,
    kind: track.kind,
    sampleKey:
      track.sampleId && track.sampleVersion != null
        ? `${track.sampleId}:${track.sampleVersion}`
        : null,
    gain: track.gain,
    muted: track.muted,
    soloed: track.soloed,
    steps: track.steps.map((s) => ({
      active: s.active,
      velocity: s.velocity,
      sampleKey:
        s.sampleId && s.sampleVersion != null
          ? `${s.sampleId}:${s.sampleVersion}`
          : null,
    })),
  };
}

function freezeEffect(effect: EffectState): EngineEffectSnapshot {
  return {
    kind: effect.kind,
    enabled: effect.enabled,
    params: { ...effect.params },
  };
}
