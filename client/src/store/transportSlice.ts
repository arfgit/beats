import type { StateCreator } from "zustand";
import type { SampleRef } from "@beats/shared";
import { computeMatrixRecordingCapMs, WAV_CAP_MS } from "@beats/shared";
import { audioEngine } from "@/audio/engine";
import { forwardPatternSamples } from "@/audio/bridge";
import {
  createMatrixController,
  defaultCellToPattern,
  type MatrixController,
} from "@/audio/matrixController";
import type { RecordingResult } from "@/audio/recorder";
import { track } from "@/lib/analytics";
import type { BeatsStore } from "./useBeatsStore";

export interface TransportSlice {
  transport: {
    audioReady: boolean;
    priming: boolean;
    isPlaying: boolean;
    isRecording: boolean;
    /**
     * True while a previously-captured recording is being played back via
     * the `<audio>` element in RecorderPanel. Mutually exclusive with
     * `isPlaying` — starting the live transport clears this (so any live
     * audio doesn't stomp the take), and the audio element setting this to
     * true does NOT stop the live transport on its own (the listener in
     * RecorderPanel does that via an explicit stop call, so the exclusion
     * logic lives in one place).
     */
    isRecordingPlayback: boolean;
    lastError: string | null;
  };
  ensureEngineStarted: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  togglePlay: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  setRecordingPlayback: (active: boolean) => void;
  /**
   * Fire a one-shot preview of the track's currently-loaded sample so the
   * user hears what they picked / enabled without having to press play.
   */
  previewTrack: (trackId: string) => void;
}

export const createTransportSlice: StateCreator<
  BeatsStore,
  [],
  [],
  TransportSlice
> = (set, get) => {
  // Track the in-flight prime so concurrent callers (play / record / space
  // shortcut) await the same promise instead of slipping past `priming:true`
  // and calling into an engine that hasn't finished starting yet.
  let primingPromise: Promise<void> | null = null;
  let matrixController: MatrixController | null = null;

  function ensureMatrixController(): MatrixController {
    if (matrixController) return matrixController;
    matrixController = createMatrixController({
      engine: audioEngine,
      getMatrix: () => get().matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange: (cellId) => {
        // Mirror engine state into store so the matrix UI can highlight
        // the currently-playing cell. Falls back to null when transport
        // stops.
        get().setActiveCellId(cellId);
      },
      onPatternInstalled: (pattern, previous) => {
        // Engine snapshot is already updated by this point; also kick
        // the sample bridge so voice buffers re-attach to the new cell's
        // samples. Without this, cells advance but the engine keeps
        // playing the first cell's sounds — same-bug different-layer.
        void forwardPatternSamples(pattern, previous ?? undefined);
      },
    });
    return matrixController;
  }

  return {
    transport: {
      audioReady: false,
      priming: false,
      isPlaying: false,
      isRecording: false,
      isRecordingPlayback: false,
      lastError: null,
    },

    ensureEngineStarted: async () => {
      if (get().transport.audioReady) return;
      if (primingPromise) return primingPromise;
      set((s) => ({
        transport: { ...s.transport, priming: true, lastError: null },
      }));
      primingPromise = (async () => {
        try {
          const resolver = (sample: SampleRef) =>
            get().resolveSampleUrl(sample);
          await audioEngine.ensureStarted(resolver);
          set((s) => ({
            transport: {
              ...s.transport,
              audioReady: true,
              priming: false,
              lastError: null,
            },
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({
            transport: { ...s.transport, priming: false, lastError: message },
          }));
          throw err;
        } finally {
          primingPromise = null;
        }
      })();
      return primingPromise;
    },

    play: async () => {
      await get().ensureEngineStarted();
      // Flush any in-progress pattern edits back into the selected cell
      // before starting — otherwise the matrix controller would begin
      // with a stale snapshot of the user's current work.
      get().syncPatternIntoMatrix();
      const ctrl = ensureMatrixController();
      ctrl.start();
      // Clear isRecordingPlayback so RecorderPanel's <audio> element pauses
      // — playing live audio while a previous take plays back would mix the
      // two, which is never what anyone wants.
      set((s) => ({
        transport: {
          ...s.transport,
          isPlaying: true,
          isRecordingPlayback: false,
        },
      }));
      track("play");
    },

    stop: () => {
      if (!audioEngine.isStarted()) return;
      matrixController?.stop();
      set((s) => ({ transport: { ...s.transport, isPlaying: false } }));
      track("stop");
    },

    togglePlay: async () => {
      if (get().transport.isPlaying) get().stop();
      else await get().play();
    },

    startRecording: async () => {
      await get().ensureEngineStarted();
      const maxMs = computeMatrixRecordingCapMs(get().matrix);
      await audioEngine.startRecording(maxMs);
      // If the take will run past the WAV threshold, tell the user up
      // front so they know the downloaded file won't be WAV — much
      // nicer than silently returning .webm at stop time.
      if (maxMs > WAV_CAP_MS) {
        get().pushToast(
          "info",
          `long loop — recording will download as compressed audio`,
        );
      }
      set((s) => ({ transport: { ...s.transport, isRecording: true } }));
      track("record_start");
    },

    stopRecording: async () => {
      if (!get().transport.isRecording) return null;
      try {
        const result = await audioEngine.stopRecording();
        set((s) => ({ transport: { ...s.transport, isRecording: false } }));
        track("record_stop", {
          bytes: result.blob.size,
          format: result.format,
        });
        return result;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        set((s) => ({
          transport: { ...s.transport, isRecording: false, lastError: detail },
        }));
        // Surface the failure to the user directly rather than relying on
        // the caller to read `lastError` — a failed take otherwise just
        // resets the UI with no explanation.
        get().pushToast("error", `recording failed: ${detail}`);
        return null;
      }
    },

    setRecordingPlayback: (active) => {
      // When a recording starts playing, stop the live transport — same
      // mutual-exclusion principle as the play() path, from the opposite
      // direction. Idempotent when already in the desired state.
      set((s) => {
        if (s.transport.isRecordingPlayback === active) return {};
        const next = { ...s.transport, isRecordingPlayback: active };
        if (active && s.transport.isPlaying) {
          // Route stops through the matrix controller so the engine, step
          // subscribers, and activeCellId all tear down consistently.
          matrixController?.stop();
          next.isPlaying = false;
        }
        return { transport: next };
      });
    },

    previewTrack: (trackId) => {
      if (!audioEngine.isStarted()) return;
      audioEngine.previewTrack(trackId);
    },
  };
};
