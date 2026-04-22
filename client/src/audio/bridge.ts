import * as Tone from "tone";
import type { Pattern, SampleRef } from "@beats/shared";
import { audioEngine } from "./engine";
import { getOrInitSharedPool } from "./samplePool";
import { useBeatsStore } from "@/store/useBeatsStore";

// Module-scoped so both the bridge subscription AND the matrix
// controller attach through the same stale-guard map. Without a shared
// latest-request map, rapid cell advancement could land a buffer from
// the outgoing cell on top of one already loaded for the incoming cell.
const latestRequest = new Map<string, string>();

async function resolveSampleForTrack(
  sampleId: string,
  kind: SampleRef["kind"],
): Promise<SampleRef | null> {
  let sample = useBeatsStore.getState().findSampleById(sampleId);
  if (!sample) {
    await useBeatsStore
      .getState()
      .fetchSamples(kind)
      .catch(() => undefined);
    sample = useBeatsStore.getState().findSampleById(sampleId);
  }
  return sample ?? null;
}

/**
 * Fetch + decode every referenced sample into the shared pool. Safe to
 * call before the user gesture — Tone's AudioContext is suspended at
 * construction, and decodeAudioData works on suspended contexts. Running
 * this on app load means first Play has zero fetch/decode latency.
 */
export async function prewarmPatternSamples(pattern: Pattern): Promise<void> {
  const pool = getOrInitSharedPool(
    (sample) => useBeatsStore.getState().resolveSampleUrl(sample),
    () => Tone.getContext().rawContext as unknown as BaseAudioContext,
  );

  await Promise.all(
    pattern.tracks.map(async (track) => {
      if (!track.sampleId || track.sampleVersion == null) return;
      const sample = await resolveSampleForTrack(track.sampleId, track.kind);
      if (!sample) return;
      if (pool.has(sample)) return;
      try {
        await pool.load(sample);
      } catch (err) {
        console.warn(`[audio] prewarm failed for ${sample.id}`, err);
      }
    }),
  );
}

/**
 * Loads + attaches samples for every track in `pattern` that has a
 * sampleId assigned. Skips tracks whose `previous` entry already has
 * the same sample (idempotent re-runs are free). Exported so the matrix
 * controller can call it at cell-advance time — otherwise voices keep
 * whatever buffers were attached from the previous cell's pattern.
 */
export async function forwardPatternSamples(
  pattern: Pattern,
  previous?: Pattern,
): Promise<void> {
  for (const track of pattern.tracks) {
    if (!track.sampleId || track.sampleVersion == null) continue;
    const prevTrack = previous?.tracks.find((t) => t.id === track.id);
    if (
      prevTrack?.sampleId === track.sampleId &&
      prevTrack?.sampleVersion === track.sampleVersion
    ) {
      continue;
    }

    const sample = await resolveSampleForTrack(track.sampleId, track.kind);
    if (!sample) continue;

    const requestKey = `${sample.id}:${sample.version}`;
    latestRequest.set(track.id, requestKey);

    try {
      await audioEngine.attachSampleIfCurrent(
        track.id,
        sample,
        () => latestRequest.get(track.id) === requestKey,
      );
    } catch (err) {
      console.error(`[audio] failed to attach sample ${sample.id}`, err);
      const message = err instanceof Error ? err.message : "sample load failed";
      useBeatsStore
        .getState()
        .pushToast("error", `couldn't load ${sample.name}: ${message}`);
    }
  }
}

/**
 * Wires patternSlice → audioEngine. Subscribes to pattern changes and
 * forwards them in two phases:
 *   1. Prewarm — fetch + decode sample buffers into the shared pool.
 *      Runs always, regardless of engine state, so first Play is instant.
 *   2. Attach — write the pattern snapshot onto the live graph and wire
 *      decoded buffers to voices. Requires the engine to have started
 *      (i.e., user gesture has happened).
 *
 * Samples are looked up in `samplesSlice`, which is populated from the
 * Firestore `samples` collection. If the sample isn't cached yet we fetch
 * the owning kind's list before retrying.
 *
 * During matrix playback (`transport.isPlaying === true`) the matrix
 * controller owns the engine snapshot — calling `engine.setPattern`
 * here would clobber the currently-active cell's snapshot with the
 * SELECTED cell's pattern, which makes multiple cells appear to play
 * "at the same time" as edits ping-pong the active cell. Gate on
 * `!isPlaying` so the bridge only writes the engine snapshot when the
 * transport is idle (i.e., for live preview of edits + the ▸ button).
 */
export function startPatternBridge(): () => void {
  let previousPattern: Pattern | undefined;
  const unsubscribe = useBeatsStore.subscribe((state, prev) => {
    if (state.pattern === prev.pattern) return;
    void prewarmPatternSamples(state.pattern);
    if (!audioEngine.isStarted()) return;
    const isPlaying = state.transport.isPlaying;
    if (!isPlaying) {
      audioEngine.setPattern(state.pattern);
    }
    void forwardPatternSamples(state.pattern, previousPattern);
    previousPattern = state.pattern;
  });

  const current = useBeatsStore.getState().pattern;
  void prewarmPatternSamples(current);
  if (audioEngine.isStarted()) {
    audioEngine.setPattern(current);
    void forwardPatternSamples(current);
    previousPattern = current;
  }

  return unsubscribe;
}
