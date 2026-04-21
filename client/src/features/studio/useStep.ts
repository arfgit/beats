import { useAudioEvent } from "@/audio/useAudioEvent";

/** Playhead current step index — subscribes outside Zustand via engine observable. */
export function useStep(): number {
  return useAudioEvent("step", -1);
}
