import * as Tone from "tone";
import type { TrackKind } from "@beats/shared";

/**
 * Per-sample voice chain that hangs off a track. Each subvoice owns its
 * own player + velocityGain so different samples on the same row can
 * ring simultaneously without their envelopes clashing. All subvoices
 * on a track share the downstream trackGain / mute-solo chain.
 *
 *   player → velocityGain → trackGain → destination
 *                            ^ shared across subs
 */
export interface SubVoice {
  readonly sampleKey: string;
  readonly player: Tone.Player;
  readonly velocityGain: Tone.Gain;
  bufferLoaded: boolean;
}

/**
 * Per-track voice. The `subVoices` map holds one chain per unique
 * sample the track is currently wired to. The scheduler picks a
 * subvoice per step by `step.sampleKey ?? track.sampleKey` and fires
 * that one, so swapping the row's sample doesn't rewrite the audio of
 * already-placed steps.
 */
export interface TrackVoice {
  readonly id: string;
  readonly kind: TrackKind;
  readonly trackGain: Tone.Gain;
  readonly destination: Tone.InputNode;
  readonly subVoices: Map<string, SubVoice>;
}

export function createTrackVoice(
  id: string,
  kind: TrackKind,
  destination: Tone.InputNode,
): TrackVoice {
  const trackGain = new Tone.Gain(0.8);
  trackGain.connect(destination);
  return {
    id,
    kind,
    trackGain,
    destination,
    subVoices: new Map(),
  };
}

/**
 * Look up the subvoice for a sampleKey on this track, creating it if
 * it's the first time we've seen this sample. Idempotent.
 */
export function ensureSubVoice(voice: TrackVoice, sampleKey: string): SubVoice {
  const existing = voice.subVoices.get(sampleKey);
  if (existing) return existing;
  const velocityGain = new Tone.Gain(1);
  const player = new Tone.Player();
  player.connect(velocityGain);
  velocityGain.connect(voice.trackGain);
  const sub: SubVoice = {
    sampleKey,
    player,
    velocityGain,
    bufferLoaded: false,
  };
  voice.subVoices.set(sampleKey, sub);
  return sub;
}

export function setSubVoiceBuffer(sub: SubVoice, buffer: AudioBuffer): void {
  sub.player.buffer = new Tone.ToneAudioBuffer(buffer);
  sub.bufferLoaded = true;
}

export function disposeSubVoice(sub: SubVoice): void {
  sub.player.dispose();
  sub.velocityGain.dispose();
  sub.bufferLoaded = false;
}

export function disposeVoice(voice: TrackVoice): void {
  for (const sub of voice.subVoices.values()) disposeSubVoice(sub);
  voice.subVoices.clear();
  voice.trackGain.dispose();
}

export function isSubVoiceLoaded(sub: SubVoice | undefined): sub is SubVoice {
  return !!sub && sub.bufferLoaded && sub.player.loaded;
}

/**
 * Prune subvoices that aren't in `keepKeys`. Used after setPattern to
 * dispose voices for samples that no longer appear anywhere on the
 * track, keeping the audio graph tight.
 */
export function pruneSubVoices(
  voice: TrackVoice,
  keepKeys: ReadonlySet<string>,
): void {
  for (const [key, sub] of voice.subVoices) {
    if (keepKeys.has(key)) continue;
    disposeSubVoice(sub);
    voice.subVoices.delete(key);
  }
}
