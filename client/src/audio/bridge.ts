import type { Pattern, SampleRef } from "@beats/shared";
import { audioEngine } from "./engine";
import { useBeatsStore } from "@/store/useBeatsStore";
import { findSample } from "@/data/builtinSamples";

/**
 * Wires patternSlice → audioEngine. Subscribes to pattern changes and
 * forwards them: graph params flow through setPattern immediately; new
 * sample assignments trigger async load + attach. A shallow diff avoids
 * redundant sample loads on every step toggle.
 */
export function startPatternBridge(): () => void {
  const forwardSamples = async (pattern: Pattern, previous?: Pattern) => {
    for (const track of pattern.tracks) {
      if (!track.sampleId || track.sampleVersion == null) continue;
      const prevTrack = previous?.tracks.find((t) => t.id === track.id);
      if (
        prevTrack?.sampleId === track.sampleId &&
        prevTrack?.sampleVersion === track.sampleVersion
      ) {
        continue;
      }
      const sample = findSample(track.sampleId);
      if (!sample) continue;
      try {
        await audioEngine.attachSample(track.id, sample as SampleRef);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[audio] failed to attach sample ${sample.id}`, err);
      }
    }
  };

  let previousPattern: Pattern | undefined;
  const unsubscribe = useBeatsStore.subscribe((state, prev) => {
    if (state.pattern === prev.pattern) return;
    audioEngine.setPattern(state.pattern);
    void forwardSamples(state.pattern, previousPattern);
    previousPattern = state.pattern;
  });

  // prime once on boot
  const current = useBeatsStore.getState().pattern;
  audioEngine.setPattern(current);
  void forwardSamples(current);
  previousPattern = current;

  return unsubscribe;
}
