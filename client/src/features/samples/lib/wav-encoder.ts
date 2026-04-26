/**
 * Minimal WAV PCM 16-bit encoder. Takes an AudioBuffer (the
 * Web Audio shape produced by `AudioContext.decodeAudioData` and the
 * trimmer's slice helper) and returns a `Blob` with a `RIFF`/`WAVE`
 * header followed by interleaved little-endian samples.
 *
 * Why hand-rolled: an MP3 / Opus encoder would add ~100-500 KB to the
 * bundle for a feature most users never touch; WAV PCM 16-bit is the
 * cheapest format `decodeAudioData` knows and our cap math (15 s
 * stereo 44.1 kHz = 2.65 MB) puts us comfortably under the 3 MiB
 * quota cap with headroom.
 */

const WAV_HEADER_BYTES = 44;

/**
 * Encode an AudioBuffer as 16-bit PCM WAV bytes. Returns the raw
 * ArrayBuffer; the call site decides whether to wrap it in a `Blob`,
 * a `File`, or stream it via `fetch` body. Keeping the encoder
 * Blob-free makes it trivially testable in jsdom (which ships only a
 * stub Blob without `arrayBuffer()`).
 */
export function encodeWavBytes(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = numFrames * blockAlign;
  const totalBytes = WAV_HEADER_BYTES + dataBytes;

  const out = new ArrayBuffer(totalBytes);
  const view = new DataView(out);
  let p = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  const writeU32 = (n: number) => {
    view.setUint32(p, n, true);
    p += 4;
  };
  const writeU16 = (n: number) => {
    view.setUint16(p, n, true);
    p += 2;
  };

  writeStr("RIFF");
  writeU32(totalBytes - 8);
  writeStr("WAVE");
  writeStr("fmt ");
  writeU32(16); // fmt chunk size for PCM
  writeU16(1); // PCM format code
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(bitsPerSample);
  writeStr("data");
  writeU32(dataBytes);

  // Interleave channels into the data section. Read each channel into
  // its own Float32Array up front so we don't pay `getChannelData`'s
  // bounds-check cost per frame.
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      // Clamp to [-1, 1] before scaling — `decodeAudioData` can return
      // values slightly outside that range due to FP precision, and an
      // unclamped multiply would overflow the int16 range and wrap.
      const raw = channels[c]![frame]!;
      const clamped = raw < -1 ? -1 : raw > 1 ? 1 : raw;
      // Round-half-away-from-zero quantization minimizes the error
      // between the float input and the int16 representation. `| 0`
      // would truncate toward zero and bias the signal.
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(p, Math.round(scaled), true);
      p += 2;
    }
  }

  return out;
}

/** Convenience wrapper for the upload flow — returns a Blob ready to PUT. */
export function encodeWav(buffer: AudioBuffer): Blob {
  return new Blob([encodeWavBytes(buffer)], { type: "audio/wav" });
}
