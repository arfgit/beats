import { describe, it, expect } from "vitest";
import { encodeWav } from "./wav";

/**
 * Lightweight AudioBuffer stub — Vitest's jsdom doesn't provide Web Audio.
 * We only use the fields encodeWav reads.
 */
function makeBuffer(samples: number[][], sampleRate = 48000): AudioBuffer {
  return {
    numberOfChannels: samples.length,
    length: samples[0]?.length ?? 0,
    sampleRate,
    duration: (samples[0]?.length ?? 0) / sampleRate,
    getChannelData: (i: number) => new Float32Array(samples[i] ?? []),
  } as unknown as AudioBuffer;
}

function readString(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++)
    out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe("encodeWav", () => {
  it("writes a valid RIFF/WAVE header", () => {
    const buf = makeBuffer([[0, 0.5, -0.5, 0]]);
    const out = encodeWav(buf);
    const view = new DataView(out);
    expect(readString(view, 0, 4)).toBe("RIFF");
    expect(readString(view, 8, 4)).toBe("WAVE");
    expect(readString(view, 12, 4)).toBe("fmt ");
    expect(readString(view, 36, 4)).toBe("data");
  });

  it("reports correct byte lengths for mono 48kHz", () => {
    const buf = makeBuffer([new Array(1000).fill(0)]);
    const out = encodeWav(buf);
    const view = new DataView(out);
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM format
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(2000); // data bytes (1000 * 2)
    expect(out.byteLength).toBe(44 + 2000);
  });

  it("interleaves stereo samples correctly (L R L R)", () => {
    const left = [1, 0];
    const right = [-1, 0];
    const buf = makeBuffer([left, right], 44100);
    const out = encodeWav(buf);
    const view = new DataView(out);
    expect(view.getInt16(44, true)).toBe(0x7fff); // L[0] = 1.0 → +32767
    expect(view.getInt16(46, true)).toBe(-0x8000); // R[0] = -1.0 → -32768
    expect(view.getInt16(48, true)).toBe(0); // L[1]
    expect(view.getInt16(50, true)).toBe(0); // R[1]
  });

  it("clamps samples outside [-1, 1]", () => {
    const buf = makeBuffer([[2, -2]]);
    const out = encodeWav(buf);
    const view = new DataView(out);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it("handles empty buffers without crashing", () => {
    const buf = makeBuffer([[]]);
    const out = encodeWav(buf);
    expect(out.byteLength).toBe(44);
  });
});
