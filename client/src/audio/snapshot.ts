import type {
  EffectKind,
  EffectState,
  Pattern,
  Track,
  TrackKind,
} from "@beats/shared";

export interface EngineTrackSnapshot {
  id: string;
  kind: TrackKind;
  sampleKey: string | null;
  gain: number;
  muted: boolean;
  soloed: boolean;
  steps: ReadonlyArray<{ active: boolean; velocity: number }>;
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
    steps: track.steps.map((s) => ({ active: s.active, velocity: s.velocity })),
  };
}

function freezeEffect(effect: EffectState): EngineEffectSnapshot {
  return {
    kind: effect.kind,
    enabled: effect.enabled,
    params: { ...effect.params },
  };
}
