import { useCallback, useRef, useSyncExternalStore } from "react";
import { audioEngine } from "./engine";
import type { EventPayloadMap } from "./subscribers";

/**
 * Subscribe to engine step or rec events via useSyncExternalStore.
 * Coalesces updates into the React render cycle so the store stays
 * completely out of the audio-thread callback path.
 */
export function useAudioEvent<E extends "step" | "rec">(
  event: E,
  initial: EventPayloadMap[E],
): EventPayloadMap[E] {
  const valueRef = useRef<EventPayloadMap[E]>(initial);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Persistent engine subscriber — safe to call before ensureStarted().
      return audioEngine.subscribe(event, (payload) => {
        valueRef.current = payload as EventPayloadMap[E];
        onStoreChange();
      });
    },
    [event],
  );

  const getSnapshot = useCallback(() => valueRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
