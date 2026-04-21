import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";

interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: string;
  valueDisplay?: string;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { label, valueDisplay, className, ...rest },
  ref,
) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className="text-[10px] uppercase tracking-widest text-ink-muted w-16 shrink-0">
        {label}
      </span>
      <input
        ref={ref}
        type="range"
        className="flex-1 h-1 appearance-none bg-grid rounded accent-neon-magenta cursor-pointer"
        aria-label={label}
        {...rest}
      />
      {valueDisplay !== undefined && (
        <span className="text-[10px] font-mono text-neon-cyan w-10 text-right">
          {valueDisplay}
        </span>
      )}
    </div>
  );
});
