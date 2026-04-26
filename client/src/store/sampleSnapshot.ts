import type { SampleRef, Track, TrackStep } from "@beats/shared";

/**
 * Single source of truth for the three identity fields a track or step
 * pins from a `SampleRef`. Centralizing prevents drift across the write
 * sites — toggleStep, setTrackSample, setStepSample, buildTrack, demo
 * composers — when a future field is added (e.g. storagePath) only this
 * file changes.
 *
 * Field rules:
 *  - `sampleId` / `sampleVersion`: identity for the audio engine.
 *  - `sampleName`: snapshot for the render path. Stored RAW (matching
 *    `SampleRef.name`); polished at render via `polishSampleName`.
 */

export type SampleSnapshotFields = Pick<
  TrackStep,
  "sampleId" | "sampleVersion" | "sampleName"
>;

/** Snapshot fields to merge onto a step when activating or replacing. */
export function snapshotForStep(
  sample: SampleRef | null,
): SampleSnapshotFields {
  if (!sample) return { sampleId: null, sampleVersion: null, sampleName: null };
  return {
    sampleId: sample.id,
    sampleVersion: sample.version,
    sampleName: sample.name,
  };
}

/** Snapshot fields to merge onto a track when picking its sample. */
export function snapshotForTrack(
  sample: SampleRef | null,
): Pick<Track, "sampleId" | "sampleVersion" | "sampleName"> {
  if (!sample) return { sampleId: null, sampleVersion: null, sampleName: null };
  return {
    sampleId: sample.id,
    sampleVersion: sample.version,
    sampleName: sample.name,
  };
}
