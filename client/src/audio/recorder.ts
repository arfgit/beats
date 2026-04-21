import * as Tone from "tone";
import { MAX_RECORDING_MS } from "@beats/shared";
import type { EngineSubscribers } from "./subscribers";

// Inline worker URL import via Vite — the `?worker&url` query yields a URL
// that Vite bundles and serves correctly in dev and prod.
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
  chunks: Blob[];
  startedAt: number;
  capTimer: ReturnType<typeof setTimeout> | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  mimeType: string;
}

export interface RecorderController {
  isRecording: () => boolean;
  start: (
    attachTap: (node: MediaStreamAudioDestinationNode) => void,
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
    chunks: [],
    startedAt: 0,
    capTimer: null,
    tickTimer: null,
    mimeType: "audio/webm",
  };

  const resetTimers = () => {
    if (state.capTimer) clearTimeout(state.capTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.capTimer = null;
    state.tickTimer = null;
  };

  const teardown = () => {
    resetTimers();
    if (state.streamDest) {
      state.streamDest.disconnect();
      state.streamDest = null;
    }
    state.mediaRecorder = null;
    state.chunks = [];
    state.active = false;
  };

  return {
    isRecording: () => state.active,

    start: async (attachTap) => {
      if (state.active) return;
      const mimeType = pickMimeType();
      const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
      const streamDest = rawCtx.createMediaStreamDestination();
      attachTap(streamDest);

      const mediaRecorder = new MediaRecorder(streamDest.stream, { mimeType });
      state.mediaRecorder = mediaRecorder;
      state.streamDest = streamDest;
      state.chunks = [];
      state.mimeType = mimeType;
      state.startedAt = performance.now();
      state.active = true;

      mediaRecorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) state.chunks.push(evt.data);
      };

      mediaRecorder.start(1000); // timeslice to flush chunks incrementally

      subscribers.emit("rec", { active: true, elapsedMs: 0 });
      state.tickTimer = setInterval(() => {
        subscribers.emit("rec", {
          active: state.active,
          elapsedMs: Math.round(performance.now() - state.startedAt),
        });
      }, 250);

      state.capTimer = setTimeout(() => {
        // hard cap: stop the recorder; caller's promise resolves normally
        if (state.active && state.mediaRecorder?.state === "recording") {
          state.mediaRecorder.stop();
        }
      }, MAX_RECORDING_MS);
    },

    stop: async () => {
      if (!state.active || !state.mediaRecorder) {
        throw new Error("recorder not running");
      }
      const recorder = state.mediaRecorder;
      const containerBlob: Blob = await new Promise((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(state.chunks, { type: state.mimeType }));
        if (recorder.state === "recording") recorder.stop();
      });
      const mimeType = state.mimeType;
      subscribers.emit("rec", {
        active: false,
        elapsedMs: Math.round(performance.now() - state.startedAt),
      });
      teardown();
      return encodeInWorker(containerBlob, mimeType);
    },

    dispose: () => {
      if (state.active && state.mediaRecorder?.state === "recording") {
        state.mediaRecorder.stop();
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
