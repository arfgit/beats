import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";

const kindStyles: Record<string, string> = {
  info: "border-neon-cyan text-neon-cyan",
  success: "border-neon-green text-neon-green",
  warn: "border-neon-sun text-neon-sun",
  error: "border-neon-red text-neon-red",
};

export function Toaster() {
  const toasts = useBeatsStore((s) => s.ui.toasts);
  const dismiss = useBeatsStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            "pointer-events-auto px-3 py-2 rounded bg-bg-panel border font-mono text-xs",
            "min-w-[220px] text-left",
            kindStyles[t.kind] ?? kindStyles.info,
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
