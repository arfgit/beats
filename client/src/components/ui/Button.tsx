import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

type Variant = "primary" | "ghost" | "danger" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded font-mono text-sm uppercase tracking-wider " +
  "transition-colors duration-200 ease-in " +
  "focus-visible:outline-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed " +
  "motion-reduce:transition-none";

// Softer synthwave palette: borders keep the neon accent but hover state
// shifts to a subtle ink color rather than flooding the button with full
// neon. Primary-on-hover is the only variant that still colors the bg,
// and it now uses a soft 15%-alpha tint instead of the full magenta flash.
const variants: Record<Variant, string> = {
  primary:
    "px-4 h-10 bg-transparent border border-neon-magenta text-neon-magenta " +
    "hover:bg-neon-magenta/15",
  ghost:
    "px-4 h-10 bg-transparent border border-grid text-ink-dim " +
    "hover:border-ink-dim hover:text-ink",
  danger:
    "px-4 h-10 bg-transparent border border-neon-red/70 text-neon-red " +
    "hover:bg-neon-red/15",
  icon:
    "h-9 w-9 bg-transparent border border-grid text-ink-dim " +
    "hover:border-ink-dim hover:text-ink",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      leading,
      trailing,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={clsx(base, variants[variant], className)}
        {...rest}
      >
        {leading}
        {children}
        {trailing}
      </button>
    );
  },
);
