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

/**
 * Reports to the store whether the AudioContext is currently suspended in
 * a way that needs a user gesture to recover — e.g., returning to the tab
 * on Safari/iOS, which holds contexts suspended across visibility swaps.
 */
type SuspensionHandler = (suspended: boolean) => void;
let suspensionHandler: SuspensionHandler = () => undefined;

export function setSuspensionHandler(handler: SuspensionHandler): void {
  suspensionHandler = handler;
}

async function onVisibilityChange(): Promise<void> {
  const transport = Tone.getTransport();
  const rawCtx = Tone.getContext().rawContext as AudioContext;
  if (document.hidden) {
    if (transport.state === "started" && !isRecordingProbe()) {
      transport.pause();
      state.pausedByVisibility = true;
    }
    return;
  }
  if (!state.pausedByVisibility) return;
  state.pausedByVisibility = false;
  // On most browsers the context auto-resumes with visibility; Safari/iOS
  // often leaves it suspended until a fresh user gesture. Try resume, then
  // branch on the actual post-resume state.
  try {
    if (rawCtx.state === "suspended") await rawCtx.resume();
  } catch {
    // resume can reject on browsers that strictly require a gesture —
    // handled by the suspended-branch below.
  }
  if (rawCtx.state === "running") {
    transport.start();
    suspensionHandler(false);
  } else {
    // Context still suspended — surface "tap to resume" to the UI.
    suspensionHandler(true);
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
  suspensionHandler = () => undefined;
}
