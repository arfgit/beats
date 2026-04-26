/**
 * Downsample an AudioBuffer to a min/max envelope sized to a given
 * pixel width. Each output bucket holds the loudest negative + most
 * positive samples in its slice of the source — that's what gives the
 * familiar two-sided waveform render. Mono is computed by averaging
 * channels first; stereo would double the work for marginal visual
 * gain at this size.
 */

export interface WaveformPeaks {
  width: number;
  mins: Float32Array;
  maxs: Float32Array;
}

export function computePeaks(
  buffer: AudioBuffer,
  width: number,
): WaveformPeaks {
  const safeWidth = Math.max(1, Math.floor(width));
  const mins = new Float32Array(safeWidth);
  const maxs = new Float32Array(safeWidth);
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const samplesPerBucket = Math.max(1, Math.floor(length / safeWidth));

  // Pre-fetch channel data once to avoid the per-bucket bounds-check
  // overhead of `getChannelData` (V8 can't hoist it through closures).
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  for (let bucket = 0; bucket < safeWidth; bucket++) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(length, start + samplesPerBucket);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < numChannels; c++) sum += channels[c]![i]!;
      const sample = sum / numChannels;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    mins[bucket] = min;
    maxs[bucket] = max;
  }

  return { width: safeWidth, mins, maxs };
}
