import { describe, it, expect } from "vitest";
import { sliceAudioBuffer } from "./audio-slice";

// jsdom polyfills. The slicer reads the same surface the encoder does
// (channels, sampleRate, length, getChannelData) and additionally calls
// `ctx.createBuffer()` — so we hand it a fake context that returns a
// matching shape.
function makeContext() {
  return {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data: Float32Array[] = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels: channels,
        sampleRate,
        length,
        duration: length / sampleRate,
        getChannelData: (c: number) => data[c]!,
      } as unknown as AudioBuffer;
    },
  } as unknown as OfflineAudioContext;
}

function rampBuffer(numFrames: number, sampleRate = 1_000): AudioBuffer {
  // Sample N has value N / numFrames, so the slice is sample-accurate
  // and easy to assert.
  const data = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) data[i] = i / numFrames;
  return {
    numberOfChannels: 1,
    sampleRate,
    length: numFrames,
    duration: numFrames / sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe("sliceAudioBuffer", () => {
  it("slices to the exact sample range for the given ms window", () => {
    // 1000 frames at 1kHz → 1s of audio. ms ↔ sample is 1:1.
    const buf = rampBuffer(1000);
    const sliced = sliceAudioBuffer(buf, 100, 200, makeContext());
    expect(sliced.length).toBe(100);
    const ch = sliced.getChannelData(0);
    expect(ch[0]).toBeCloseTo(100 / 1000);
    expect(ch[99]).toBeCloseTo(199 / 1000);
  });

  it("clamps a negative startMs to zero", () => {
    const buf = rampBuffer(100);
    const sliced = sliceAudioBuffer(buf, -50, 30, makeContext());
    expect(sliced.length).toBe(30);
    expect(sliced.getChannelData(0)[0]).toBeCloseTo(0);
  });

  it("clamps an over-end endMs to the buffer length", () => {
    const buf = rampBuffer(100);
    const sliced = sliceAudioBuffer(buf, 50, 9999, makeContext());
    expect(sliced.length).toBe(50);
    expect(sliced.getChannelData(0)[49]).toBeCloseTo(99 / 100);
  });

  it("guarantees at least one frame even for inverted bounds", () => {
    const buf = rampBuffer(100);
    const sliced = sliceAudioBuffer(buf, 80, 20, makeContext());
    expect(sliced.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves channel count for a stereo buffer", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      left[i] = i;
      right[i] = -i;
    }
    const buf = {
      numberOfChannels: 2,
      sampleRate: 1_000,
      length: 100,
      duration: 0.1,
      getChannelData: (c: number) => (c === 0 ? left : right),
    } as unknown as AudioBuffer;

    // jsdom polyfill needs to know numChannels — extend the fake ctx.
    const ctx = {
      createBuffer: (channels: number, length: number, sampleRate: number) => {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        return {
          numberOfChannels: channels,
          sampleRate,
          length,
          duration: length / sampleRate,
          getChannelData: (c: number) => data[c]!,
        } as unknown as AudioBuffer;
      },
    } as unknown as OfflineAudioContext;

    const sliced = sliceAudioBuffer(buf, 10, 20, ctx);
    expect(sliced.numberOfChannels).toBe(2);
    expect(sliced.getChannelData(0)[0]).toBe(10);
    expect(sliced.getChannelData(1)[0]).toBe(-10);
  });
});
