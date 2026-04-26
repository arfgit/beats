import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";

/**
 * Esc disarms the currently armed sample. Lives at the studio shell so
 * users can always abort a "place sample" gesture — armed mode is the
 * one piece of hidden state in the studio and we want a universally
 * known escape hatch (matches the WAI-ARIA APG dialog/menu pattern of
 * "Esc closes the modal verb"). Skips when focus is on a text input so
 * users editing track names don't accidentally disarm mid-typing.
 */
export function useDisarmOnEscape(): void {
  const armedSampleId = useBeatsStore((s) => s.ui.armedSampleId);
  const armSample = useBeatsStore((s) => s.armSample);
  useEffect(() => {
    if (!armedSampleId) return;
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key !== "Escape") return;
      const target = evt.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      armSample(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armedSampleId, armSample]);
}
