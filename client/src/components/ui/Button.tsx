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

const variants: Record<Variant, string> = {
  primary:
    "px-4 h-10 bg-transparent border border-neon-magenta text-neon-magenta " +
    "hover:bg-neon-magenta hover:text-bg-void " +
    "shadow-[var(--glow-magenta)]",
  ghost:
    "px-4 h-10 bg-transparent border border-grid text-ink-dim " +
    "hover:border-neon-violet hover:text-neon-violet",
  danger:
    "px-4 h-10 bg-transparent border border-neon-red text-neon-red " +
    "hover:bg-neon-red hover:text-bg-void",
  icon:
    "h-9 w-9 bg-transparent border border-grid text-ink-dim " +
    "hover:border-neon-cyan hover:text-neon-cyan",
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
