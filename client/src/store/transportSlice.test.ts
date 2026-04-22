import { describe, it, expect, beforeEach, vi } from "vitest";

// The store imports the audio engine at module load. Mock it before the
// store is imported so the slice picks up the mocked version and we never
// actually touch Tone.js / the Web Audio API in a unit test.
vi.mock("@/audio/engine", () => ({
  audioEngine: {
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(new Blob()),
    isStarted: vi.fn().mockReturnValue(true),
    previewTrack: vi.fn(),
    // matrix controller calls these on cell advancement
    setPattern: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    reset: vi.fn(),
  },
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

const { useBeatsStore } = await import("./useBeatsStore");

describe("transport ↔ recording playback exclusivity", () => {
  beforeEach(() => {
    // Reset transport slice to a known baseline between tests.
    useBeatsStore.setState((s) => ({
      transport: {
        ...s.transport,
        audioReady: true,
        priming: false,
        isPlaying: false,
        isRecording: false,
        isRecordingPlayback: false,
        lastError: null,
      },
    }));
  });

  it("setRecordingPlayback(true) while playing stops the live transport", () => {
    useBeatsStore.setState((s) => ({
      transport: { ...s.transport, isPlaying: true },
    }));

    useBeatsStore.getState().setRecordingPlayback(true);

    const t = useBeatsStore.getState().transport;
    expect(t.isRecordingPlayback).toBe(true);
    expect(t.isPlaying).toBe(false);
  });

  it("play() clears isRecordingPlayback", async () => {
    useBeatsStore.setState((s) => ({
      transport: { ...s.transport, isRecordingPlayback: true },
    }));

    await useBeatsStore.getState().play();

    const t = useBeatsStore.getState().transport;
    expect(t.isPlaying).toBe(true);
    expect(t.isRecordingPlayback).toBe(false);
  });

  it("setRecordingPlayback is idempotent when already in target state", () => {
    // Already false — calling with false shouldn't touch isPlaying.
    useBeatsStore.setState((s) => ({
      transport: {
        ...s.transport,
        isPlaying: true,
        isRecordingPlayback: false,
      },
    }));

    useBeatsStore.getState().setRecordingPlayback(false);

    const t = useBeatsStore.getState().transport;
    expect(t.isPlaying).toBe(true);
    expect(t.isRecordingPlayback).toBe(false);
  });

  it("setRecordingPlayback(false) leaves isPlaying alone", () => {
    useBeatsStore.setState((s) => ({
      transport: { ...s.transport, isPlaying: true, isRecordingPlayback: true },
    }));

    useBeatsStore.getState().setRecordingPlayback(false);

    const t = useBeatsStore.getState().transport;
    expect(t.isPlaying).toBe(true);
    expect(t.isRecordingPlayback).toBe(false);
  });
});
