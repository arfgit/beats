import clsx from "clsx";
import { Tooltip } from "./Tooltip";

/**
 * Small "ⓘ" marker that shows a tooltip on hover/focus. Use it next to
 * labels, knobs, or any UI element whose tooltip is worth advertising —
 * the icon makes the presence of hover-info discoverable instead of
 * hidden. Pure display element: does not wrap its siblings, place it
 * inline next to the labelled thing.
 *
 * Example:
 *   <span>master gain <InfoIcon label="controls the project's output volume" /></span>
 */
export function InfoIcon({
  label,
  className,
  size = "sm",
}: {
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const dims = size === "md" ? "h-4 w-4 text-[10px]" : "h-3.5 w-3.5 text-[9px]";
  return (
    <Tooltip label={label}>
      <span
        role="img"
        aria-label={`info: ${label}`}
        tabIndex={0}
        className={clsx(
          "inline-flex items-center justify-center rounded-full",
          "border border-grid text-ink-muted hover:text-ink hover:border-ink-muted",
          "transition-colors duration-200 ease-in motion-reduce:transition-none",
          "cursor-help leading-none select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet",
          dims,
          className,
        )}
      >
        i
      </span>
    </Tooltip>
  );
}
