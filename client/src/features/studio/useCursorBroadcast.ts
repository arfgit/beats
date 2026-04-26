import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";

/**
 * Capture the local user's pointer position over a designated cursor
 * surface and broadcast it to the live session at ~10 Hz. Coords are
 * normalized [0, 1] against the surface bounding rect so peers with
 * different viewport sizes see the cursor land in the same logical
 * spot — Figma's trick.
 *
 * No-ops when there's no live session (which means presence emits
 * never go anywhere) so the listener is always safe to mount at the
 * studio root.
 */
export function useCursorBroadcast(
  surface: React.RefObject<HTMLElement | null>,
): void {
  const sessionId = useBeatsStore((s) => s.collab.session.id);
  const emitPresence = useBeatsStore((s) => s.emitPresence);

  useEffect(() => {
    if (!sessionId) return;
    const el = surface.current;
    if (!el) return;

    let lastEmit = 0;
    let pending: { x: number; y: number } | null = null;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      if (!pending) return;
      const now = performance.now();
      if (now - lastEmit < 100) {
        // Throttle to ~10 Hz. Re-schedule for the next eligible tick
        // so a fast mouse move doesn't drop the final position.
        rafId = window.setTimeout(flush, 100 - (now - lastEmit));
        return;
      }
      lastEmit = now;
      const { x, y } = pending;
      pending = null;
      emitPresence({ x, y }, null);
    };

    const onMove = (evt: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (evt.clientX - rect.left) / rect.width;
      const y = (evt.clientY - rect.top) / rect.height;
      // Drop coords that are off-surface — peers see "your cursor
      // left the studio" rather than a clamped edge ghost.
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        pending = null;
        return;
      }
      pending = { x, y };
      if (rafId === null) rafId = window.setTimeout(flush, 0);
    };

    const onLeave = () => {
      pending = null;
      // Tell peers we've left the surface — emitPresence with no cursor
      // tells the consumer to fade the cursor out.
      emitPresence(null, null);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (rafId !== null) window.clearTimeout(rafId);
    };
  }, [sessionId, surface, emitPresence]);
}
