import { useCallback, useId, useRef } from "react";
import clsx from "clsx";

interface KnobProps {
  label: string;
  /** Accessible name for the slider element. Defaults to `label` when omitted. */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  valueDisplay?: (value: number) => string;
  size?: number;
  className?: string;
}

/**
 * Accessible rotary knob. Drag vertically to change, arrow keys nudge,
 * double-click resets to `defaultValue` (DAW convention). Uses pointer
 * events (no dependency on drag libs) and a native-role slider for screen
 * readers via `role="slider"` + aria-value*.
 */
export function Knob({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  onChange,
  valueDisplay,
  size = 56,
  className,
}: KnobProps) {
  const startPos = useRef<{ y: number; value: number } | null>(null);
  const id = useId();

  const clamp = useCallback(
    (n: number) => Math.max(min, Math.min(max, n)),
    [min, max],
  );

  const onPointerDown = useCallback(
    (evt: React.PointerEvent) => {
      (evt.currentTarget as HTMLElement).setPointerCapture(evt.pointerId);
      startPos.current = { y: evt.clientY, value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (evt: React.PointerEvent) => {
      const start = startPos.current;
      if (!start) return;
      const deltaPx = start.y - evt.clientY; // up = increase
      // Shift-drag is 4x finer for precise adjustments
      const pixelsForFullRange = evt.shiftKey ? 480 : 120;
      const delta = (deltaPx / pixelsForFullRange) * (max - min);
      const next = clamp(start.value + delta);
      const rounded = Math.round(next / step) * step;
      onChange(clamp(rounded));
    },
    [max, min, onChange, step, clamp],
  );

  const onPointerUp = useCallback((evt: React.PointerEvent) => {
    (evt.currentTarget as HTMLElement).releasePointerCapture(evt.pointerId);
    startPos.current = null;
  }, []);

  const onKeyDown = useCallback(
    (evt: React.KeyboardEvent) => {
      const bigStep = step * 10;
      const delta =
        evt.key === "ArrowUp" || evt.key === "ArrowRight"
          ? step
          : evt.key === "ArrowDown" || evt.key === "ArrowLeft"
            ? -step
            : evt.key === "PageUp"
              ? bigStep
              : evt.key === "PageDown"
                ? -bigStep
                : 0;
      if (delta !== 0) {
        evt.preventDefault();
        onChange(clamp(value + delta));
      }
      if (evt.key === "Home" && defaultValue !== undefined) {
        evt.preventDefault();
        onChange(clamp(defaultValue));
      }
    },
    [onChange, step, value, clamp, defaultValue],
  );

  const onDoubleClick = useCallback(() => {
    if (defaultValue !== undefined) onChange(clamp(defaultValue));
  }, [defaultValue, onChange, clamp]);

  const pct = (value - min) / (max - min);
  const rotation = -135 + pct * 270; // -135° … +135°

  return (
    <div className={clsx("flex flex-col items-center gap-1", className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={ariaLabel ?? label}
        aria-describedby={`${id}-val`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        title={
          defaultValue !== undefined
            ? "drag · shift-drag for precision · double-click to reset"
            : "drag · shift-drag for precision"
        }
        style={{ width: size, height: size }}
        className={clsx(
          "relative rounded-full border border-grid bg-bg-panel-2",
          "cursor-ns-resize select-none focus-visible:outline-none",
          "hover:border-neon-violet transition-colors duration-150",
          "motion-reduce:transition-none",
        )}
      >
        {/* subtle inner ring to look more tactile */}
        <div className="absolute inset-1 rounded-full border border-grid/50 pointer-events-none" />
        <div
          className="absolute top-1/2 left-1/2 w-[3px] h-[42%] bg-neon-magenta rounded-full"
          style={{
            transform: `translate(-50%, -100%) rotate(${rotation}deg)`,
            transformOrigin: "center bottom",
          }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-widest text-ink-muted">
        {label}
      </span>
      <span id={`${id}-val`} className="text-[10px] font-mono text-neon-cyan">
        {valueDisplay ? valueDisplay(value) : value.toFixed(2)}
      </span>
    </div>
  );
}
