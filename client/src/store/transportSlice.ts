import type { StateCreator } from "zustand";
import { audioEngine } from "@/audio/engine";
import { resolveBuiltInUrl } from "@/data/builtinSamples";
import { track } from "@/lib/analytics";

export interface TransportSlice {
  transport: {
    audioReady: boolean;
    isPlaying: boolean;
    isRecording: boolean;
    lastError: string | null;
  };
  ensureEngineStarted: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  togglePlay: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
}

export const createTransportSlice: StateCreator<
  TransportSlice,
  [],
  [],
  TransportSlice
> = (set, get) => ({
  transport: {
    audioReady: false,
    isPlaying: false,
    isRecording: false,
    lastError: null,
  },

  ensureEngineStarted: async () => {
    if (get().transport.audioReady) return;
    try {
      await audioEngine.ensureStarted(resolveBuiltInUrl);
      set((s) => ({
        transport: { ...s.transport, audioReady: true, lastError: null },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({ transport: { ...s.transport, lastError: message } }));
      throw err;
    }
  },

  play: async () => {
    await get().ensureEngineStarted();
    await audioEngine.play();
    set((s) => ({ transport: { ...s.transport, isPlaying: true } }));
    track("play");
  },

  stop: () => {
    if (!audioEngine.isStarted()) return;
    audioEngine.stop();
    set((s) => ({ transport: { ...s.transport, isPlaying: false } }));
    track("stop");
  },

  togglePlay: async () => {
    if (get().transport.isPlaying) get().stop();
    else await get().play();
  },

  startRecording: async () => {
    await get().ensureEngineStarted();
    await audioEngine.startRecording();
    set((s) => ({ transport: { ...s.transport, isRecording: true } }));
    track("record_start");
  },

  stopRecording: async () => {
    if (!get().transport.isRecording) return null;
    try {
      const blob = await audioEngine.stopRecording();
      set((s) => ({ transport: { ...s.transport, isRecording: false } }));
      track("record_stop", { bytes: blob.size });
      return blob;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        transport: { ...s.transport, isRecording: false, lastError: message },
      }));
      return null;
    }
  },
});
