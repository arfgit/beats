import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  label: string;
  placement?: Placement;
  children: ReactElement<{
    "aria-describedby"?: string;
    onFocus?: () => void;
    onBlur?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }>;
  /** Render tooltip even if globally disabled — used for critical info. */
  force?: boolean;
}

export function Tooltip({
  label,
  placement = "top",
  children,
  force = false,
}: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLElement | null>(null);
  const enabled = useBeatsStore((s) => s.ui.tooltipsEnabled);

  const [effectivePlacement, setEffectivePlacement] =
    useState<Placement>(placement);

  const show = () => {
    if (!enabled && !force) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    // Approximate tooltip size — bounded above since we no longer force
    // nowrap; actual wrapping is handled by the rendered element.
    const estWidth = Math.min(label.length * 7 + 20, 320);
    const estHeight = 32;

    // Auto-flip when the preferred placement would overflow.
    let resolved: Placement = placement;
    if (placement === "top" && rect.top - gap - estHeight < 0)
      resolved = "bottom";
    else if (
      placement === "bottom" &&
      rect.bottom + gap + estHeight > viewportHeight
    )
      resolved = "top";
    else if (placement === "left" && rect.left - gap - estWidth < 0)
      resolved = "right";
    else if (
      placement === "right" &&
      rect.right + gap + estWidth > viewportWidth
    )
      resolved = "left";

    const raw = (() => {
      switch (resolved) {
        case "bottom":
          return { top: rect.bottom + gap, left: rect.left + rect.width / 2 };
        case "left":
          return { top: rect.top + rect.height / 2, left: rect.left - gap };
        case "right":
          return { top: rect.top + rect.height / 2, left: rect.right + gap };
        case "top":
        default:
          return { top: rect.top - gap, left: rect.left + rect.width / 2 };
      }
    })();

    // Clamp horizontal offset so the centered tooltip body stays fully
    // onscreen. left/right placements anchor to an edge, so only top/bottom
    // need the centered clamp.
    const padding = 8;
    let { top, left } = raw;
    if (resolved === "top" || resolved === "bottom") {
      const half = estWidth / 2;
      const min = padding + half;
      const max = viewportWidth - padding - half;
      left = Math.min(Math.max(left, min), max);
    } else {
      // For left/right, prevent vertical overflow from the centered anchor.
      const half = estHeight / 2;
      const min = padding + half;
      const max = viewportHeight - padding - half;
      top = Math.min(Math.max(top, min), max);
    }

    setEffectivePlacement(resolved);
    setCoords({ top, left });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  // Stale-tooltip hardening. Tooltips sometimes get stuck on screen
  // when:
  //  1. The trigger unmounts while hovered (mouseleave never fires).
  //  2. The user scrolls — the cached coords no longer match the
  //     trigger's screen position.
  //  3. The tab loses focus / visibility flips.
  //  4. The trigger moves under another stacked element and the
  //     pointer crosses out without firing leave on the right node.
  // Add a cleanup pass while open: hide on scroll, blur, visibility
  // hidden, and on unmount. Cheap (only attached when open).
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    const onBlur = () => setOpen(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") setOpen(false);
    };
    const onPointerMove = (e: PointerEvent) => {
      const trigger = triggerRef.current;
      if (!trigger) {
        setOpen(false);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [open]);

  // Belt-and-suspenders: when the consumer unmounts the trigger
  // (route change, list re-render, etc.) while the tooltip is open,
  // close it on our own unmount.
  useEffect(() => {
    return () => setOpen(false);
  }, []);

  if (!isValidElement(children)) return children;

  const attachRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
  };

  const childProps = children.props;
  const wrapped = cloneElement(children, {
    ref: attachRef,
    "aria-describedby": open ? tooltipId : childProps["aria-describedby"],
    // Compose rather than clobber — if the consumer passes their own handlers,
    // call ours alongside theirs.
    onMouseEnter: () => {
      show();
      childProps.onMouseEnter?.();
    },
    onMouseLeave: () => {
      hide();
      childProps.onMouseLeave?.();
    },
    onFocus: () => {
      show();
      childProps.onFocus?.();
    },
    onBlur: () => {
      hide();
      childProps.onBlur?.();
    },
  });

  return (
    <>
      {wrapped}
      {open && coords
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
              className={clsx(
                "fixed z-[9999] pointer-events-none px-2 py-1 rounded",
                "bg-bg-panel border border-neon-violet text-ink text-xs font-mono",
                "shadow-[var(--glow-violet)] max-w-[320px] whitespace-normal leading-snug",
                effectivePlacement === "top" &&
                  "-translate-x-1/2 -translate-y-full",
                effectivePlacement === "bottom" && "-translate-x-1/2",
                effectivePlacement === "left" &&
                  "-translate-x-full -translate-y-1/2",
                effectivePlacement === "right" && "-translate-y-1/2",
              )}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface TooltipProviderProps {
  children: ReactNode;
}
export function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>;
}
