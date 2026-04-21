import {
  cloneElement,
  isValidElement,
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

  const show = () => {
    if (!enabled && !force) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const position = (() => {
      switch (placement) {
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
    setCoords(position);
    setOpen(true);
  };
  const hide = () => setOpen(false);

  if (!isValidElement(children)) return children;

  const attachRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
  };

  const wrapped = cloneElement(children, {
    ref: attachRef,
    "aria-describedby": open ? tooltipId : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  } as Record<string, unknown>);

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
                "shadow-[var(--glow-violet)] whitespace-nowrap",
                placement === "top" && "-translate-x-1/2 -translate-y-full",
                placement === "bottom" && "-translate-x-1/2",
                placement === "left" && "-translate-x-full -translate-y-1/2",
                placement === "right" && "-translate-y-1/2",
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
