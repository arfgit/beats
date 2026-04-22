import type { SampleRef } from "@beats/shared";

/**
 * Process-wide shared pool. Both the audio engine (post-gesture) and the
 * pre-gesture prewarm path (see audio/bridge.ts) write into the same
 * instance so buffers decoded before Play are reused instead of re-fetched.
 */
let shared: SamplePool | null = null;

export function getOrInitSharedPool(
  resolveUrl: (sample: SampleRef) => Promise<string>,
  ctx: () => BaseAudioContext,
): SamplePool {
  if (!shared) shared = new SamplePool(resolveUrl, ctx);
  return shared;
}

export function currentSharedPool(): SamplePool | null {
  return shared;
}

/** Test hook: wipe the cache and drop the singleton. */
export function resetSharedPoolForTests(): void {
  shared?.clear();
  shared = null;
}

/**
 * Decode-once AudioBuffer cache. Keyed by `${sampleId}:${version}` so old
 * versions remain resolvable for projects that pinned to them.
 */
export class SamplePool {
  private readonly cache = new Map<string, Promise<AudioBuffer>>();
  private readonly resolveUrl: (sample: SampleRef) => Promise<string>;
  private readonly ctx: () => BaseAudioContext;

  constructor(
    resolveUrl: (sample: SampleRef) => Promise<string>,
    ctx: () => BaseAudioContext,
  ) {
    this.resolveUrl = resolveUrl;
    this.ctx = ctx;
  }

  key(sample: SampleRef): string {
    return `${sample.id}:${sample.version}`;
  }

  async load(sample: SampleRef): Promise<AudioBuffer> {
    const key = this.key(sample);
    const existing = this.cache.get(key);
    if (existing) return existing;
    const promise = this.fetchAndDecode(sample);
    this.cache.set(key, promise);
    try {
      return await promise;
    } catch (err) {
      this.cache.delete(key);
      throw err;
    }
  }

  has(sample: SampleRef): boolean {
    return this.cache.has(this.key(sample));
  }

  clear(): void {
    this.cache.clear();
  }

  private async fetchAndDecode(sample: SampleRef): Promise<AudioBuffer> {
    const url = await this.resolveUrl(sample);
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`sample fetch failed: ${res.status} ${sample.id}`);
    const buffer = await res.arrayBuffer();
    return this.ctx().decodeAudioData(buffer);
  }
}
