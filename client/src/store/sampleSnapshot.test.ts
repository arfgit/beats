import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SampleRef } from "@beats/shared";

vi.mock("@/audio/engine", () => ({
  audioEngine: {
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(new Blob()),
    isStarted: vi.fn().mockReturnValue(false),
    previewTrack: vi.fn(),
    setPattern: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    reset: vi.fn(),
  },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { useBeatsStore } = await import("./useBeatsStore");

function makeSample(
  id: string,
  name: string,
  kind: SampleRef["kind"] = "drums",
): SampleRef {
  return {
    id,
    kind,
    name,
    storagePath: `samples/${id}.wav`,
    version: 1,
    durationMs: 500,
    isBuiltIn: true,
    createdAt: 0,
  };
}

function seedSamples(samples: SampleRef[]): void {
  // Hydrate the samples slice with a ready state so findSampleById hits.
  // Uses setState directly because fetchSamples touches Firestore.
  useBeatsStore.setState((s) => ({
    samples: {
      ...s.samples,
      drums: { status: "ready", samples, error: null },
    },
  }));
}

describe("step-as-object snapshots", () => {
  beforeEach(() => {
    useBeatsStore.getState().resetMatrix();
    useBeatsStore.getState().resetPattern();
  });

  it("toggleStep pins sampleName from the live samples slice", () => {
    const kick = makeSample("kick-1", "Kick 808");
    seedSamples([kick]);
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;
    useBeatsStore
      .getState()
      .setTrackSample(drumsTrack.id, kick.id, kick.version);
    useBeatsStore.getState().toggleStep(drumsTrack.id, 0);

    const step = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!.steps[0]!;
    expect(step.active).toBe(true);
    expect(step.sampleId).toBe("kick-1");
    expect(step.sampleName).toBe("Kick 808");
  });

  it("setTrackSample updates the track but leaves existing step snapshots untouched (the rename-bug fix)", () => {
    const kick = makeSample("kick-1", "Kick 808");
    const snare = makeSample("snare-1", "Snare 909");
    seedSamples([kick, snare]);
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;

    useBeatsStore
      .getState()
      .setTrackSample(drumsTrack.id, kick.id, kick.version);
    useBeatsStore.getState().toggleStep(drumsTrack.id, 0);
    // Now swap the row's sample. The step placed earlier must keep its
    // original snapshot — that's the contract the bug fix promises.
    useBeatsStore
      .getState()
      .setTrackSample(drumsTrack.id, snare.id, snare.version);

    const updated = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!;
    expect(updated.sampleId).toBe("snare-1");
    expect(updated.sampleName).toBe("Snare 909");
    expect(updated.steps[0]!.sampleId).toBe("kick-1");
    expect(updated.steps[0]!.sampleName).toBe("Kick 808");
  });

  it("setStepSample replaces only the targeted step + activates it", () => {
    const kick = makeSample("kick-1", "Kick 808");
    const clap = makeSample("clap-1", "Clap 707");
    seedSamples([kick, clap]);
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;
    useBeatsStore
      .getState()
      .setTrackSample(drumsTrack.id, kick.id, kick.version);
    useBeatsStore.getState().toggleStep(drumsTrack.id, 0); // active, kick
    useBeatsStore.getState().toggleStep(drumsTrack.id, 1); // active, kick

    useBeatsStore
      .getState()
      .setStepSample(drumsTrack.id, 1, clap.id, clap.version);

    const updated = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!;
    // Step 1 got the clap; step 0 still has kick; track default unchanged.
    expect(updated.steps[0]!.sampleId).toBe("kick-1");
    expect(updated.steps[0]!.sampleName).toBe("Kick 808");
    expect(updated.steps[1]!.sampleId).toBe("clap-1");
    expect(updated.steps[1]!.sampleName).toBe("Clap 707");
    expect(updated.steps[1]!.active).toBe(true);
    expect(updated.sampleId).toBe("kick-1");
  });

  it("setStepSample on an inactive step activates it (drop-to-place)", () => {
    const kick = makeSample("kick-1", "Kick 808");
    seedSamples([kick]);
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;

    useBeatsStore
      .getState()
      .setStepSample(drumsTrack.id, 3, kick.id, kick.version);
    const step = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!.steps[3]!;
    expect(step.active).toBe(true);
    expect(step.sampleId).toBe("kick-1");
    expect(step.sampleName).toBe("Kick 808");
  });

  it("clearTrackSample wipes track + step snapshots so the row is fully blank", () => {
    const kick = makeSample("kick-1", "Kick 808");
    seedSamples([kick]);
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;
    useBeatsStore
      .getState()
      .setTrackSample(drumsTrack.id, kick.id, kick.version);
    useBeatsStore.getState().toggleStep(drumsTrack.id, 0);

    useBeatsStore.getState().clearTrackSample(drumsTrack.id);

    const updated = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!;
    expect(updated.sampleId).toBeNull();
    expect(updated.sampleName).toBeNull();
    expect(updated.steps[0]!.active).toBe(false);
    expect(updated.steps[0]!.sampleName).toBeUndefined();
  });

  it("toggleStep falls back to track-pinned name when samples slice misses (legacy hydration race)", () => {
    // Simulate the race: samples slice is empty but track has been
    // pre-populated with sampleId+sampleName (e.g. via remote project
    // load). toggleStep should still pin the name onto the activated
    // step from the track-level snapshot.
    const drumsTrack = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.kind === "drums")!;
    useBeatsStore.setState((s) => ({
      pattern: {
        ...s.pattern,
        tracks: s.pattern.tracks.map((t) =>
          t.id === drumsTrack.id
            ? {
                ...t,
                sampleId: "kick-legacy",
                sampleVersion: 1,
                sampleName: "Legacy Kick",
              }
            : t,
        ),
      },
    }));
    useBeatsStore.getState().toggleStep(drumsTrack.id, 0);

    const step = useBeatsStore
      .getState()
      .pattern.tracks.find((t) => t.id === drumsTrack.id)!.steps[0]!;
    expect(step.sampleName).toBe("Legacy Kick");
  });
});
