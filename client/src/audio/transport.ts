import * as Tone from "tone";
import type { EnginePatternSnapshot, EngineTrackSnapshot } from "./snapshot";
import type { TrackVoice } from "./players";
import { isVoiceLoaded } from "./players";
import type { EngineSubscribers } from "./subscribers";

const MIN_VELOCITY = 0.001;
const VELOCITY_RAMP_SEC = 0.005;

export interface TransportController {
  readonly sequence: Tone.Sequence<number>;
  start: () => void;
  stop: () => void;
  setBpm: (bpm: number) => void;
  dispose: () => void;
}

export function createTransport(
  getSnapshot: () => EnginePatternSnapshot,
  getVoice: (trackId: string) => TrackVoice | undefined,
  subscribers: EngineSubscribers,
): TransportController {
  const steps = Array.from({ length: 8 }, (_, i) => i);
  const sequence = new Tone.Sequence<number>(
    (time: number, step: number) => {
      const snapshot = getSnapshot();
      for (const track of snapshot.tracks) {
        if (!shouldTrigger(track, step, snapshot.anySoloed)) continue;
        const voice = getVoice(track.id);
        if (!voice || !isVoiceLoaded(voice)) continue;
        const velocity = Math.max(
          MIN_VELOCITY,
          track.steps[step]?.velocity ?? 1,
        );
        voice.velocityGain.gain.cancelScheduledValues(time);
        voice.velocityGain.gain.setValueAtTime(velocity, time);
        voice.player.start(time);
      }
      // emit outside the audio-critical path; consumers should rAF-coalesce
      subscribers.emit("step", step);
    },
    steps,
    "8n",
  );
  sequence.loop = true;

  return {
    sequence,
    start: () => {
      const transport = Tone.getTransport();
      transport.bpm.value = getSnapshot().bpm;
      if (sequence.state !== "started") sequence.start(0);
      if (transport.state !== "started") transport.start("+0.01");
    },
    stop: () => {
      const transport = Tone.getTransport();
      if (sequence.state === "started") sequence.stop(0);
      if (transport.state === "started") transport.stop();
      transport.position = 0;
    },
    setBpm: (bpm: number) => {
      Tone.getTransport().bpm.rampTo(bpm, VELOCITY_RAMP_SEC);
    },
    dispose: () => sequence.dispose(),
  };
}

function shouldTrigger(
  track: EngineTrackSnapshot,
  step: number,
  anySoloed: boolean,
): boolean {
  const stepData = track.steps[step];
  if (!stepData?.active) return false;
  if (track.muted) return false;
  if (anySoloed && !track.soloed) return false;
  if (track.sampleKey === null) return false;
  return true;
}
