import * as Tone from "tone";
import type { Pattern, SampleRef } from "@beats/shared";
import { TRACK_KINDS } from "@beats/shared";
import { ensureStarted, setIsRecordingProbe } from "./context";
import type { SamplePool} from "./samplePool";
import { getOrInitSharedPool } from "./samplePool";
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
  // Persistent subscribers instance — survives engine start/reset so React
  // hooks mounted before ensureStarted() still receive events once it runs.
  private readonly subscribers = new EngineSubscribers();
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

    // Adopt the process-wide pool so buffers the bridge decoded before the
    // user gesture are reused rather than re-fetched on first Play.
    const samplePool = getOrInitSharedPool(
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

    const recorder = createRecorder(this.subscribers);
    setIsRecordingProbe(() => recorder.isRecording());

    const snapshot = emptySnapshot();
    const transport = createTransport(
      () => this.internals!.snapshot,
      (id) => voices.get(id),
      this.subscribers,
    );

    this.internals = {
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
   *
   * If `options.previewOnReady` is set, fires a one-shot as soon as the
   * buffer lands — this is how the dropdown auditions a sample the user
   * just picked without racing on a setTimeout.
   */
  async attachSampleIfCurrent(
    trackId: string,
    sample: SampleRef,
    isStillCurrent: () => boolean,
    options?: { previewOnReady?: boolean },
  ): Promise<void> {
    const ints = this.requireStarted();
    const voice = ints.voices.get(trackId);
    if (!voice) throw new Error(`unknown trackId: ${trackId}`);
    const buffer = await ints.samplePool.load(sample);
    if (!isStillCurrent()) return;
    const key = ints.samplePool.key(sample);
    if (voice.currentBufferKey !== key) setVoiceBuffer(voice, buffer, key);
    if (options?.previewOnReady) this.previewTrack(trackId);
  }

  async play(): Promise<void> {
    const ints = this.requireStarted();
    await ensureStarted();
    ints.transport.start();
  }

  /**
   * Fire a single one-shot of the given track's currently-loaded sample.
   * Used for sample auditioning (on selection) and step-toggle previews
   * so the user hears what they're adding without having to press play.
   * No-op if the track has no loaded buffer.
   */
  previewTrack(trackId: string, velocity = 0.9): void {
    if (!this.internals) return;
    const voice = this.internals.voices.get(trackId);
    if (!voice || !voice.player.loaded || voice.currentBufferKey === null) {
      return;
    }
    try {
      const now = Tone.now();
      voice.velocityGain.gain.cancelScheduledValues(now);
      voice.velocityGain.gain.setValueAtTime(velocity, now);
      voice.player.start(now);
    } catch (err) {
      console.warn("[audio] preview failed", err);
    }
  }

  stop(): void {
    if (!this.internals) return;
    this.internals.transport.stop();
  }

  async startRecording(maxMs?: number): Promise<void> {
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
    }, maxMs);
  }

  async stopRecording(): Promise<import("./recorder").RecordingResult> {
    const ints = this.requireStarted();
    return ints.recorder.stop();
  }

  subscribe<E extends "step" | "rec">(
    event: E,
    cb: Parameters<EngineSubscribers["subscribe"]>[1],
  ): () => void {
    // Persistent subscribers — subscribing before ensureStarted() is fine;
    // events simply don't flow until the engine boots.
    return this.subscribers.subscribe(event, cb);
  }

  reset(): void {
    if (!this.internals) return;
    const ints = this.internals;
    ints.transport.dispose();
    ints.recorder.dispose();
    // Do NOT clear subscribers — React hooks keep their subscriptions
    // across a sign-out / engine reset.
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
