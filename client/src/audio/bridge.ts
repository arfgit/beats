import type { Pattern, SampleRef } from "@beats/shared";
import { audioEngine } from "./engine";
import { useBeatsStore } from "@/store/useBeatsStore";
import { findSample } from "@/data/builtinSamples";

/**
 * Wires patternSlice → audioEngine. Subscribes to pattern changes and
 * forwards them: graph params flow through setPattern immediately; new
 * sample assignments trigger async load + attach.
 *
 * A per-track "latest request" map guards against a race where a slow
 * load for an older sample assignment could finish after a newer one,
 * overwriting the current buffer. We only call attachSample when the
 * key we latched at request time still matches when the load completes.
 */
export function startPatternBridge(): () => void {
  const latestRequest = new Map<string, string>();

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

      const requestKey = `${sample.id}:${sample.version}`;
      latestRequest.set(track.id, requestKey);

      try {
        // Compare against the latest requested key at resolution time. If
        // the user has assigned a newer sample to this track since we
        // kicked off this load, drop the stale result on the floor.
        await audioEngine.attachSampleIfCurrent(
          track.id,
          sample as SampleRef,
          () => latestRequest.get(track.id) === requestKey,
        );
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

  const current = useBeatsStore.getState().pattern;
  audioEngine.setPattern(current);
  void forwardSamples(current);
  previousPattern = current;

  return unsubscribe;
}
