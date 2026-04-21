import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";

/**
 * Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) = redo.
 * Skipped inside text inputs.
 */
export function useUndoShortcuts(): void {
  const undo = useBeatsStore((s) => s.undo);
  const redo = useBeatsStore((s) => s.redo);

  useEffect(() => {
    const handler = (evt: KeyboardEvent) => {
      const mod = evt.metaKey || evt.ctrlKey;
      if (!mod) return;
      const target = evt.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;

      const key = evt.key.toLowerCase();
      if (key === "z" && !evt.shiftKey) {
        evt.preventDefault();
        undo();
      } else if ((key === "z" && evt.shiftKey) || key === "y") {
        evt.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);
}
