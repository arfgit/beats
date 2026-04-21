import * as Tone from "tone";

interface ContextState {
  started: boolean;
  pausedByVisibility: boolean;
  visibilityHandlerBound: boolean;
}

const state: ContextState = {
  started: false,
  pausedByVisibility: false,
  visibilityHandlerBound: false,
};

/**
 * Lazy-start the Tone.js audio context. Must be called from a user gesture.
 * Idempotent.
 */
export async function ensureStarted(): Promise<void> {
  if (state.started) return;
  await Tone.start();
  bindVisibilityHandler();
  state.started = true;
}

export function isStarted(): boolean {
  return state.started;
}

export function getDestination(): Tone.Gain {
  // Tone's Destination node — the speakers.
  return Tone.getDestination() as unknown as Tone.Gain;
}

function bindVisibilityHandler(): void {
  if (state.visibilityHandlerBound || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  state.visibilityHandlerBound = true;
}

/** Callback fired from external recording state so we don't pause during a record. */
type IsRecordingProbe = () => boolean;
let isRecordingProbe: IsRecordingProbe = () => false;

export function setIsRecordingProbe(probe: IsRecordingProbe): void {
  isRecordingProbe = probe;
}

function onVisibilityChange(): void {
  const transport = Tone.getTransport();
  if (document.hidden) {
    if (transport.state === "started" && !isRecordingProbe()) {
      transport.pause();
      state.pausedByVisibility = true;
    }
  } else if (state.pausedByVisibility) {
    state.pausedByVisibility = false;
    transport.start();
  }
}

/** For tests — reset module state. */
export function __resetContextForTests(): void {
  state.started = false;
  state.pausedByVisibility = false;
  if (state.visibilityHandlerBound && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  state.visibilityHandlerBound = false;
  isRecordingProbe = () => false;
}
