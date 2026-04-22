import type { Pattern } from "@beats/shared";
import { audioEngine } from "./engine";
import { useBeatsStore } from "@/store/useBeatsStore";

// Module-scoped so both the bridge subscription AND the matrix
// controller attach through the same stale-guard map. Without a shared
// latest-request map, rapid cell advancement could land a buffer from
// the outgoing cell on top of one already loaded for the incoming cell.
const latestRequest = new Map<string, string>();

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

    // First attempt a direct lookup; if the slice hasn't loaded this
    // kind yet, fetch and re-lookup.
    let sample = useBeatsStore.getState().findSampleById(track.sampleId);
    if (!sample) {
      await useBeatsStore.getState().fetchSamples(track.kind);
      sample = useBeatsStore.getState().findSampleById(track.sampleId);
    }
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
 * forwards them: graph params flow through setPattern immediately; new
 * sample assignments trigger async load + attach.
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
    // Engine might have been reset (sign-out) — skip until re-armed.
    if (!audioEngine.isStarted()) return;
    const isPlaying = state.transport.isPlaying;
    if (!isPlaying) {
      audioEngine.setPattern(state.pattern);
    }
    // Sample forwarding always runs so picking a new sample reflects in
    // the voice buffer immediately (useful for ▸ preview). During play
    // the controller also re-forwards on each cell boundary, so the
    // worst case here is a one-cycle-early attachment, which is fine.
    void forwardPatternSamples(state.pattern, previousPattern);
    previousPattern = state.pattern;
  });

  // Prime only if the engine actually started (bridge can be invoked
  // before the user primes audio; setPattern would throw otherwise).
  if (audioEngine.isStarted()) {
    const current = useBeatsStore.getState().pattern;
    audioEngine.setPattern(current);
    void forwardPatternSamples(current);
    previousPattern = current;
  }

  return unsubscribe;
}
