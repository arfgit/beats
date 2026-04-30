import * as Tone from "tone";
import { MAX_RECORDING_MS, WAV_CAP_MS } from "@beats/shared";
import { encodeWav } from "@/features/samples/lib/wav-encoder";
import type { EngineSubscribers } from "./subscribers";

/**
 * Media formats the recorder returns. `wav` is the transcoded uncompressed
 * output (expensive for long takes); `webm` / `mp4` are the direct
 * container from MediaRecorder, preferred above WAV_CAP_MS.
 */
export type RecordingFormat = "wav" | "webm" | "mp4";
export interface RecordingResult {
  blob: Blob;
  format: RecordingFormat;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

interface RecorderState {
  active: boolean;
  mediaRecorder: MediaRecorder | null;
  streamDest: MediaStreamAudioDestinationNode | null;
  detach: (() => void) | null;
  chunks: Blob[];
  startedAt: number;
  capTimer: ReturnType<typeof setTimeout> | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  mimeType: string;
  finalBlobPromise: Promise<Blob> | null;
  resolveFinalBlob: ((blob: Blob) => void) | null;
  rejectFinalBlob: ((err: Error) => void) | null;
}

export interface RecorderController {
  isRecording: () => boolean;
  /**
   * Begin recording. `maxMs` is the hard cap after which MediaRecorder is
   * auto-stopped. Caller computes it from the matrix loop length (via
   * `computeMatrixRecordingCapMs`) or falls back to MAX_RECORDING_MS.
   */
  start: (
    attachTap: (node: MediaStreamAudioDestinationNode) => () => void,
    maxMs?: number,
  ) => Promise<void>;
  stop: () => Promise<RecordingResult>;
  dispose: () => void;
}

export function createRecorder(
  subscribers: EngineSubscribers,
): RecorderController {
  const state: RecorderState = {
    active: false,
    mediaRecorder: null,
    streamDest: null,
    detach: null,
    chunks: [],
    startedAt: 0,
    capTimer: null,
    tickTimer: null,
    mimeType: "audio/webm",
    finalBlobPromise: null,
    resolveFinalBlob: null,
    rejectFinalBlob: null,
  };

  const resetTimers = () => {
    if (state.capTimer) clearTimeout(state.capTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.capTimer = null;
    state.tickTimer = null;
  };

  const teardown = () => {
    resetTimers();
    state.detach?.();
    state.detach = null;
    if (state.streamDest) {
      state.streamDest.disconnect();
      state.streamDest = null;
    }
    state.mediaRecorder = null;
    state.chunks = [];
    state.active = false;
    state.finalBlobPromise = null;
    state.resolveFinalBlob = null;
    state.rejectFinalBlob = null;
  };

  return {
    isRecording: () => state.active,

    start: async (attachTap, maxMs = MAX_RECORDING_MS) => {
      if (state.active) return;
      const mimeType = pickMimeType();
      const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
      const streamDest = rawCtx.createMediaStreamDestination();
      const detach = attachTap(streamDest);

      const mediaRecorder = new MediaRecorder(streamDest.stream, { mimeType });
      state.mediaRecorder = mediaRecorder;
      state.streamDest = streamDest;
      state.detach = detach;
      state.chunks = [];
      state.mimeType = mimeType;
      state.startedAt = performance.now();
      state.active = true;

      // Install onstop / ondataavailable / onerror before start so the
      // hard-cap race can't fire stop() before we're listening, and so a
      // mid-stream MediaRecorder failure surfaces as a clean rejection
      // instead of a hung promise.
      state.finalBlobPromise = new Promise<Blob>((resolve, reject) => {
        state.resolveFinalBlob = resolve;
        state.rejectFinalBlob = reject;
      });

      mediaRecorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) state.chunks.push(evt.data);
      };
      mediaRecorder.onstop = () => {
        if (state.resolveFinalBlob) {
          state.resolveFinalBlob(
            new Blob(state.chunks, { type: state.mimeType }),
          );
          state.resolveFinalBlob = null;
          state.rejectFinalBlob = null;
        }
        // Mark inactive immediately so any follow-on stop() short-circuits.
        state.active = false;
        subscribers.emit("rec", {
          active: false,
          elapsedMs: Math.round(performance.now() - state.startedAt),
        });
      };
      mediaRecorder.onerror = (evt) => {
        const err =
          (evt as unknown as { error?: DOMException }).error ??
          new Error("MediaRecorder error");
        if (state.rejectFinalBlob) {
          state.rejectFinalBlob(
            err instanceof Error ? err : new Error(String(err)),
          );
          state.resolveFinalBlob = null;
          state.rejectFinalBlob = null;
        }
        state.active = false;
        subscribers.emit("rec", {
          active: false,
          elapsedMs: Math.round(performance.now() - state.startedAt),
        });
      };

      mediaRecorder.start(1000);

      subscribers.emit("rec", { active: true, elapsedMs: 0 });
      state.tickTimer = setInterval(() => {
        subscribers.emit("rec", {
          active: state.active,
          elapsedMs: Math.round(performance.now() - state.startedAt),
        });
      }, 250);

      state.capTimer = setTimeout(
        () => {
          if (state.mediaRecorder?.state === "recording") {
            state.mediaRecorder.stop();
          }
        },
        Math.max(1000, maxMs),
      );
    },

    stop: async () => {
      // Snapshot the promise before any teardown — the cap timer may have
      // already fired onstop, in which case the promise already resolved.
      const finalBlobPromise = state.finalBlobPromise;
      if (!finalBlobPromise) {
        throw new Error("recorder not running");
      }
      const recorder = state.mediaRecorder;
      if (recorder?.state === "recording") recorder.stop();

      const elapsedMs = Math.round(performance.now() - state.startedAt);
      const containerBlob = await finalBlobPromise;
      const mimeType = state.mimeType;
      teardown();
      // For anything longer than WAV_CAP_MS, return the MediaRecorder
      // container directly. Expanding to WAV would allocate hundreds of
      // megabytes for minute-long recordings — a non-starter on mobile.
      // The container format already includes a codec header so the
      // download is playable in any modern browser.
      if (elapsedMs > WAV_CAP_MS) {
        const format: RecordingFormat = mimeType.includes("mp4")
          ? "mp4"
          : "webm";
        return { blob: containerBlob, format };
      }
      const wav = await encodeContainerToWav(containerBlob, mimeType);
      return { blob: wav, format: "wav" };
    },

    dispose: () => {
      const recorder = state.mediaRecorder;
      if (recorder?.state === "recording") recorder.stop();
      // Resolve the pending promise with whatever chunks we have so any
      // caller awaiting stop() unblocks.
      if (state.resolveFinalBlob) {
        state.resolveFinalBlob(
          new Blob(state.chunks, { type: state.mimeType }),
        );
        state.resolveFinalBlob = null;
      }
      teardown();
    },
  };
}

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "audio/webm";
}

/**
 * Decode the MediaRecorder container (webm/mp4) into an AudioBuffer and
 * re-encode as WAV. Done on the main thread because OfflineAudioContext
 * isn't exposed in Web Workers on Safari (and inconsistently elsewhere)
 * — the original worker path threw "OfflineAudioContext is not defined"
 * on any browser without that API in workers. A brief main-thread pause
 * at stop() is fine for the sub-2-minute WAV path; longer takes skip
 * this entirely and ship the compressed container.
 */
async function encodeContainerToWav(
  blob: Blob,
  _mimeType: string,
): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  // Short-lived decode context — channels/sampleRate get replaced by the
  // decoded buffer's own values; constructor args here only seed the
  // minimum shape required by the spec.
  const ctx = new OfflineAudioContext(2, 1, 48000);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  return encodeWav(audioBuffer);
}
