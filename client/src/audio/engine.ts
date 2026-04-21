import * as Tone from "tone";
import type { Pattern, SampleRef } from "@beats/shared";
import { TRACK_KINDS } from "@beats/shared";
import { ensureStarted, setIsRecordingProbe } from "./context";
import { SamplePool } from "./samplePool";
import {
  createTrackVoice,
  setVoiceBuffer,
  disposeVoice,
  type TrackVoice,
} from "./players";
import {
  createEffectsChain,
  applyEffectSnapshot,
  type EffectsChain,
} from "./effects";
import { createTransport, type TransportController } from "./transport";
import { createRecorder, type RecorderController } from "./recorder";
import { EngineSubscribers } from "./subscribers";
import { freezeSnapshot, type EnginePatternSnapshot } from "./snapshot";

interface EngineInternals {
  subscribers: EngineSubscribers;
  samplePool: SamplePool;
  voices: Map<string, TrackVoice>;
  busGain: Tone.Gain;
  effects: EffectsChain;
  masterGain: Tone.Gain;
  recordTap: Tone.Gain;
  transport: TransportController;
  recorder: RecorderController;
  snapshot: EnginePatternSnapshot;
  resolveSampleUrl: (sample: SampleRef) => Promise<string>;
}

class AudioEngine {
  private internals: EngineInternals | null = null;

  /**
   * Initialize the audio graph. Must be called after a user gesture.
   * Idempotent.
   */
  async ensureStarted(
    resolveSampleUrl: (sample: SampleRef) => Promise<string> = defaultResolver,
  ): Promise<void> {
    if (this.internals) return;
    await ensureStarted();

    const subscribers = new EngineSubscribers();
    const samplePool = new SamplePool(
      resolveSampleUrl,
      () => Tone.getContext().rawContext as unknown as BaseAudioContext,
    );

    const masterGain = new Tone.Gain(0.8);
    const recordTap = new Tone.Gain(1);
    const busGain = new Tone.Gain(1);
    const effects = createEffectsChain();

    busGain.connect(effects.input);
    effects.output.connect(masterGain);
    masterGain.connect(Tone.getDestination());
    masterGain.connect(recordTap);

    const voices = new Map<string, TrackVoice>();
    for (const kind of TRACK_KINDS) {
      const voice = createTrackVoice(`track-${kind}`, kind, busGain);
      voices.set(voice.id, voice);
    }

    const recorder = createRecorder(subscribers);
    setIsRecordingProbe(() => recorder.isRecording());

    const snapshot = emptySnapshot();
    const transport = createTransport(
      () => this.internals!.snapshot,
      (id) => voices.get(id),
      subscribers,
    );

    this.internals = {
      subscribers,
      samplePool,
      voices,
      busGain,
      effects,
      masterGain,
      recordTap,
      transport,
      recorder,
      snapshot,
      resolveSampleUrl,
    };
  }

  /** Replace the engine's view of pattern state. Applied immediately. */
  setPattern(pattern: Pattern): void {
    const ints = this.requireStarted();
    const snapshot = freezeSnapshot(pattern);
    ints.snapshot = snapshot;

    // apply non-scheduled state that the snapshot owns
    ints.masterGain.gain.rampTo(snapshot.masterGain, 0.01);
    for (const track of snapshot.tracks) {
      const voice = ints.voices.get(track.id);
      if (!voice) continue;
      const targetGain = track.muted ? 0 : track.gain;
      voice.trackGain.gain.rampTo(targetGain, 0.01);
    }
    for (const effect of snapshot.effects) {
      applyEffectSnapshot(ints.effects, effect);
    }
    ints.transport.setBpm(snapshot.bpm);
  }

  /** Load and assign a sample to a specific track voice. */
  async attachSample(trackId: string, sample: SampleRef): Promise<void> {
    return this.attachSampleIfCurrent(trackId, sample, () => true);
  }

  /**
   * Same as attachSample but consults `isStillCurrent` after the decode
   * resolves. If the caller's request is stale (a newer sample has been
   * requested for the same track), the decoded buffer is discarded rather
   * than overwriting what the user has since selected.
   */
  async attachSampleIfCurrent(
    trackId: string,
    sample: SampleRef,
    isStillCurrent: () => boolean,
  ): Promise<void> {
    const ints = this.requireStarted();
    const voice = ints.voices.get(trackId);
    if (!voice) throw new Error(`unknown trackId: ${trackId}`);
    const buffer = await ints.samplePool.load(sample);
    if (!isStillCurrent()) return;
    const key = ints.samplePool.key(sample);
    if (voice.currentBufferKey === key) return;
    setVoiceBuffer(voice, buffer, key);
  }

  async play(): Promise<void> {
    const ints = this.requireStarted();
    await ensureStarted();
    ints.transport.start();
  }

  stop(): void {
    if (!this.internals) return;
    this.internals.transport.stop();
  }

  async startRecording(): Promise<void> {
    const ints = this.requireStarted();
    await ints.recorder.start((dest) => {
      ints.recordTap.connect(dest);
      // Return a detach that disconnects recordTap from exactly this
      // destination — passing the node to disconnect() scopes the op.
      return () => {
        try {
          ints.recordTap.disconnect(dest);
        } catch {
          // already disconnected — ignore
        }
      };
    });
  }

  async stopRecording(): Promise<Blob> {
    const ints = this.requireStarted();
    return ints.recorder.stop();
  }

  subscribe<E extends "step" | "rec">(
    event: E,
    cb: Parameters<EngineSubscribers["subscribe"]>[1],
  ): () => void {
    if (!this.internals) return () => {};
    return this.internals.subscribers.subscribe(event, cb);
  }

  reset(): void {
    if (!this.internals) return;
    const ints = this.internals;
    ints.transport.dispose();
    ints.recorder.dispose();
    ints.subscribers.clear();
    for (const voice of ints.voices.values()) disposeVoice(voice);
    ints.effects.dispose();
    ints.busGain.dispose();
    ints.recordTap.dispose();
    ints.masterGain.dispose();
    ints.samplePool.clear();
    this.internals = null;
  }

  /** For tests + Phase 2b bridge — read the engine's current snapshot. */
  getSnapshot(): EnginePatternSnapshot {
    return this.requireStarted().snapshot;
  }

  isStarted(): boolean {
    return this.internals !== null;
  }

  private requireStarted(): EngineInternals {
    if (!this.internals)
      throw new Error("audioEngine not started — call ensureStarted() first");
    return this.internals;
  }
}

async function defaultResolver(sample: SampleRef): Promise<string> {
  // Placeholder until Phase 4 persistence layer ships the real resolver.
  return `/samples/${sample.storagePath}`;
}

function emptySnapshot(): EnginePatternSnapshot {
  return {
    bpm: 120,
    masterGain: 0.8,
    stepCount: 8,
    anySoloed: false,
    tracks: [],
    effects: [],
  };
}

export const audioEngine = new AudioEngine();
export type { AudioEngine };
