import * as Tone from "tone";
import { MAX_RECORDING_MS } from "@beats/shared";
import type { EngineSubscribers } from "./subscribers";

// eslint-disable-next-line import/no-unresolved
import wavEncoderUrl from "@/workers/wav-encoder.ts?worker&url";

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
}

export interface RecorderController {
  isRecording: () => boolean;
  start: (
    attachTap: (node: MediaStreamAudioDestinationNode) => () => void,
  ) => Promise<void>;
  stop: () => Promise<Blob>;
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
  };

  return {
    isRecording: () => state.active,

    start: async (attachTap) => {
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

      // Install onstop / ondataavailable before start so the hard-cap
      // race can't fire stop() before we're listening.
      state.finalBlobPromise = new Promise<Blob>((resolve) => {
        state.resolveFinalBlob = resolve;
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
        }
        // Mark inactive immediately so any follow-on stop() short-circuits.
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

      state.capTimer = setTimeout(() => {
        if (state.mediaRecorder?.state === "recording") {
          state.mediaRecorder.stop();
        }
      }, MAX_RECORDING_MS);
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

      const containerBlob = await finalBlobPromise;
      const mimeType = state.mimeType;
      teardown();
      return encodeInWorker(containerBlob, mimeType);
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

function encodeInWorker(blob: Blob, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(wavEncoderUrl, { type: "module" });
    worker.onmessage = (evt: MessageEvent<{ wav?: Blob; error?: string }>) => {
      worker.terminate();
      if (evt.data.wav) resolve(evt.data.wav);
      else reject(new Error(evt.data.error ?? "wav encode failed"));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err.error ?? new Error(err.message));
    };
    worker.postMessage({ blob, mimeType });
  });
}
