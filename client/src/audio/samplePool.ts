import type { SampleRef } from "@beats/shared";

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
