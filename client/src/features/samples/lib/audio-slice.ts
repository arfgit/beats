/**
 * Slice an AudioBuffer to the half-open range `[startMs, endMs)` and
 * return a new AudioBuffer containing just those samples. Channel
 * count and sample rate are preserved. Out-of-range bounds are
 * clamped — startMs ≥ 0, endMs ≤ buffer.duration*1000, and endMs is
 * always >= startMs + 1 sample.
 */

export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
  ctx?: AudioContext | OfflineAudioContext,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const totalFrames = buffer.length;

  const startFrame = Math.max(
    0,
    Math.min(totalFrames - 1, Math.round((startMs / 1000) * sampleRate)),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(totalFrames, Math.round((endMs / 1000) * sampleRate)),
  );
  const sliceFrames = endFrame - startFrame;

  // OfflineAudioContext.createBuffer() works in tests and in browsers
  // and doesn't require a live AudioContext to exist. When a context
  // is passed in (e.g. the studio's shared context) we use it so the
  // returned buffer's sampleRate matches the destination.
  const factory =
    ctx ?? new OfflineAudioContext(numChannels, sliceFrames, sampleRate);
  const out = factory.createBuffer(numChannels, sliceFrames, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dest = out.getChannelData(c);
    // Copy via Float32Array.subarray + set — much faster than a manual
    // loop and avoids creating an intermediate copy.
    dest.set(src.subarray(startFrame, endFrame));
  }

  return out;
}
