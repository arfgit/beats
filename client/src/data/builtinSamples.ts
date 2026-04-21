import type { SampleRef, TrackKind } from "@beats/shared";

/**
 * Static built-in sample manifest. Served from `/samples/builtin/<kind>/<file>`
 * via Vite's public directory. Phase 4 replaces this with a Firestore query.
 */
export const BUILTIN_SAMPLES: ReadonlyArray<SampleRef> = [
  sample(
    "kick-808",
    "drums",
    "808 Kick",
    "samples/builtin/drums/kick-808.wav",
    400,
  ),
  sample(
    "snare-808",
    "drums",
    "808 Snare",
    "samples/builtin/drums/snare-808.wav",
    200,
  ),
  sample(
    "clap-808",
    "drums",
    "808 Clap",
    "samples/builtin/drums/clap-808.wav",
    300,
  ),
  sample(
    "hihat-808",
    "drums",
    "808 Hi-Hat",
    "samples/builtin/drums/hihat-808.wav",
    120,
  ),
  sample("bass-01", "bass", "Bass 01", "samples/builtin/bass/bass-01.wav", 800),
  sample(
    "guitar-01",
    "guitar",
    "Guitar 01",
    "samples/builtin/guitar/guitar-01.wav",
    600,
  ),
  sample(
    "vocal-01",
    "vocals",
    "Vocal 01",
    "samples/builtin/vocals/vocal-01.wav",
    900,
  ),
];

function sample(
  id: string,
  kind: TrackKind,
  name: string,
  storagePath: string,
  durationMs: number,
): SampleRef {
  return {
    id,
    kind,
    name,
    storagePath,
    version: 1,
    durationMs,
    isBuiltIn: true,
    createdAt: 0,
  };
}

export function samplesByKind(kind: TrackKind): SampleRef[] {
  return BUILTIN_SAMPLES.filter((s) => s.kind === kind);
}

export function findSample(id: string): SampleRef | undefined {
  return BUILTIN_SAMPLES.find((s) => s.id === id);
}

/**
 * Resolver used by the audio engine in Phase 2b/3. For built-in samples,
 * storagePath is a relative URL served by Vite. Phase 4 introduces signed
 * URLs via `/api/samples/:id/resolve-url` for user-uploaded samples.
 */
export async function resolveBuiltInUrl(sample: SampleRef): Promise<string> {
  if (
    sample.storagePath.startsWith("/") ||
    sample.storagePath.startsWith("samples/")
  ) {
    return `/${sample.storagePath.replace(/^\//, "")}`;
  }
  throw new Error(`unsupported sample path scheme: ${sample.storagePath}`);
}
