import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SampleRef } from "@beats/shared";
import { SamplePool } from "./samplePool";

const fakeBuffer = { duration: 1 } as AudioBuffer;

function makeSample(overrides: Partial<SampleRef> = {}): SampleRef {
  return {
    id: "kick-01",
    kind: "drums",
    name: "Kick",
    storagePath: "samples/builtin/drums/kick-01.wav",
    version: 1,
    durationMs: 500,
    isBuiltIn: true,
    createdAt: 0,
    ...overrides,
  };
}

describe("SamplePool", () => {
  const fetchSpy = vi.fn();
  const ctxSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    ctxSpy.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
  });

  it("decodes once and caches subsequent loads", async () => {
    const decode = vi.fn().mockResolvedValue(fakeBuffer);
    const ctx = { decodeAudioData: decode } as unknown as BaseAudioContext;
    const pool = new SamplePool(
      async () => "https://example/kick.wav",
      () => ctx,
    );
    const sample = makeSample();
    await pool.load(sample);
    await pool.load(sample);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(pool.has(sample)).toBe(true);
  });

  it("uses id:version as the cache key — different versions are separate entries", async () => {
    const decode = vi.fn().mockResolvedValue(fakeBuffer);
    const ctx = { decodeAudioData: decode } as unknown as BaseAudioContext;
    const pool = new SamplePool(
      async () => "https://example/kick.wav",
      () => ctx,
    );
    await pool.load(makeSample({ version: 1 }));
    await pool.load(makeSample({ version: 2 }));
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("drops failed entries so the next load retries", async () => {
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(fakeBuffer);
    const ctx = { decodeAudioData: decode } as unknown as BaseAudioContext;
    const pool = new SamplePool(
      async () => "https://example/kick.wav",
      () => ctx,
    );
    const sample = makeSample();
    await expect(pool.load(sample)).rejects.toThrow("boom");
    await expect(pool.load(sample)).resolves.toBe(fakeBuffer);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("throws when resolved URL returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    const decode = vi.fn();
    const ctx = { decodeAudioData: decode } as unknown as BaseAudioContext;
    const pool = new SamplePool(
      async () => "https://example/missing.wav",
      () => ctx,
    );
    await expect(pool.load(makeSample())).rejects.toThrow(/404/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("clear() empties the cache", async () => {
    const decode = vi.fn().mockResolvedValue(fakeBuffer);
    const ctx = { decodeAudioData: decode } as unknown as BaseAudioContext;
    const pool = new SamplePool(
      async () => "https://example/kick.wav",
      () => ctx,
    );
    await pool.load(makeSample());
    expect(pool.has(makeSample())).toBe(true);
    pool.clear();
    expect(pool.has(makeSample())).toBe(false);
  });

  // unused (kept for future test expansion)
  void fetchSpy;
  void ctxSpy;
});
