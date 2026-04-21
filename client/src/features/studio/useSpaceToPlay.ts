import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";

/** Space bar toggles playback, except when focus is on text input. */
export function useSpaceToPlay(): void {
  const togglePlay = useBeatsStore((s) => s.togglePlay);
  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.code !== "Space") return;
      const target = evt.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      evt.preventDefault();
      void togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);
}
