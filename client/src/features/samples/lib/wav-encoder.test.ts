import { describe, it, expect } from "vitest";
import { encodeWavBytes } from "./wav-encoder";

// jsdom doesn't ship Web Audio. The encoder only reads
// numberOfChannels/sampleRate/length + per-channel Float32Array, so a
// 6-line polyfill matches the shape it needs.
function fakeBuffer(
  channelData: Float32Array[],
  sampleRate = 44_100,
): AudioBuffer {
  const numberOfChannels = channelData.length;
  const length = channelData[0]!.length;
  return {
    numberOfChannels,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: (c: number) => channelData[c]!,
  } as unknown as AudioBuffer;
}

function readBytes(buf: AudioBuffer): DataView {
  return new DataView(encodeWavBytes(buf));
}

describe("encodeWav", () => {
  it("emits a valid RIFF/WAVE header and the expected total size", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = fakeBuffer([samples]);
    const wav = readBytes(buf);

    expect(
      String.fromCharCode(
        wav.getUint8(0),
        wav.getUint8(1),
        wav.getUint8(2),
        wav.getUint8(3),
      ),
    ).toBe("RIFF");
    expect(
      String.fromCharCode(
        wav.getUint8(8),
        wav.getUint8(9),
        wav.getUint8(10),
        wav.getUint8(11),
      ),
    ).toBe("WAVE");
    expect(
      String.fromCharCode(
        wav.getUint8(12),
        wav.getUint8(13),
        wav.getUint8(14),
        wav.getUint8(15),
      ),
    ).toBe("fmt ");
    // PCM format code at offset 20
    expect(wav.getUint16(20, true)).toBe(1);
    // numChannels at offset 22
    expect(wav.getUint16(22, true)).toBe(1);
    // sampleRate at offset 24
    expect(wav.getUint32(24, true)).toBe(44_100);
    // bitsPerSample at offset 34
    expect(wav.getUint16(34, true)).toBe(16);
    // total length: 44 header + 5 frames * 1 channel * 2 bytes
    expect(wav.byteLength).toBe(44 + 5 * 2);
  });

  it("clamps samples outside [-1, 1] without wrapping", async () => {
    // 1.5 unclamped → 1.5 * 0x7fff = 49150 → wraps to negative on int16
    const samples = new Float32Array([1.5, -1.5]);
    const buf = fakeBuffer([samples]);
    const wav = readBytes(buf);

    expect(wav.getInt16(44, true)).toBe(0x7fff); // +1 clamped
    expect(wav.getInt16(46, true)).toBe(-0x8000); // -1 clamped
  });

  it("interleaves stereo channels frame-major", async () => {
    const left = new Float32Array([0.25, 0.5]);
    const right = new Float32Array([-0.25, -0.5]);
    const buf = fakeBuffer([left, right]);
    const wav = readBytes(buf);

    // numChannels at offset 22 = 2
    expect(wav.getUint16(22, true)).toBe(2);
    // Frame 0: left then right
    expect(wav.getInt16(44, true)).toBe(Math.round(0.25 * 0x7fff));
    expect(wav.getInt16(46, true)).toBe(Math.round(-0.25 * 0x8000));
    // Frame 1: left then right
    expect(wav.getInt16(48, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(wav.getInt16(50, true)).toBe(Math.round(-0.5 * 0x8000));
  });

  it("preserves sample rate and channel count via byteRate", async () => {
    const samples = new Float32Array(8);
    const buf = fakeBuffer([samples, samples], 48_000);
    const wav = readBytes(buf);

    // byteRate = sampleRate * numChannels * 2  → 48000 * 2 * 2 = 192000
    expect(wav.getUint32(28, true)).toBe(192_000);
    // blockAlign = numChannels * 2 = 4
    expect(wav.getUint16(32, true)).toBe(4);
  });
});
