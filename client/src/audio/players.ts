import * as Tone from "tone";
import type { TrackKind } from "@beats/shared";

/**
 * Per-track voice: Tone.Player → velocity Gain → track Gain → output.
 *
 * velocityGain is set per-trigger from the scheduler; trackGain is set from
 * the snapshot (mute/solo/gain). Both ramp with short (5ms) linear fades to
 * avoid clicks on mute/unmute or sharp velocity changes.
 */
export interface TrackVoice {
  readonly id: string;
  readonly kind: TrackKind;
  readonly player: Tone.Player;
  readonly velocityGain: Tone.Gain;
  readonly trackGain: Tone.Gain;
  currentBufferKey: string | null;
}

export function createTrackVoice(
  id: string,
  kind: TrackKind,
  destination: Tone.InputNode,
): TrackVoice {
  const trackGain = new Tone.Gain(0.8);
  const velocityGain = new Tone.Gain(1);
  const player = new Tone.Player();
  player.connect(velocityGain);
  velocityGain.connect(trackGain);
  trackGain.connect(destination);
  return { id, kind, player, velocityGain, trackGain, currentBufferKey: null };
}

export function setVoiceBuffer(
  voice: TrackVoice,
  buffer: AudioBuffer,
  bufferKey: string,
): void {
  voice.player.buffer = new Tone.ToneAudioBuffer(buffer);
  voice.currentBufferKey = bufferKey;
}

export function clearVoiceBuffer(voice: TrackVoice): void {
  voice.player.buffer = new Tone.ToneAudioBuffer();
  voice.currentBufferKey = null;
}

export function disposeVoice(voice: TrackVoice): void {
  voice.player.dispose();
  voice.velocityGain.dispose();
  voice.trackGain.dispose();
}

export function isVoiceLoaded(voice: TrackVoice): boolean {
  return voice.player.loaded && voice.currentBufferKey !== null;
}
