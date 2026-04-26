import { useBeatsStore } from "@/store/useBeatsStore";
import { polishSampleName } from "@/lib/sampleNames";

/**
 * Persistent indicator that rendering "armed-sample" mode is active.
 * Without this, armed mode is silently global — a user could click a
 * stamp button, walk away, come back, and click a step expecting toggle
 * behavior. The banner makes the mode loud and gives a one-click escape
 * (Esc also works, courtesy of useDisarmOnEscape).
 *
 * Renders nothing when no sample is armed, so it's free to mount at the
 * studio shell.
 */
export function ArmedBanner() {
  const armedSampleId = useBeatsStore((s) => s.ui.armedSampleId);
  const armSample = useBeatsStore((s) => s.armSample);
  const findSampleById = useBeatsStore((s) => s.findSampleById);
  if (!armedSampleId) return null;
  const sample = findSampleById(armedSampleId);
  if (!sample) {
    // Sample armed but not found in the slice — most likely the slice
    // hasn't hydrated yet. Disarm rather than render a confusing empty
    // banner. (Sample deletions land here too, which is the right call.)
    armSample(null);
    return null;
  }
  const polished = polishSampleName(sample.name);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-neon-violet/60 bg-neon-violet/10 text-neon-violet font-mono text-[11px] uppercase tracking-widest"
    >
      <span className="flex items-center gap-2 min-w-0 truncate">
        <span aria-hidden>◈</span>
        <span className="truncate">
          stamping: <span className="text-ink">{polished}</span> — click steps
          to apply
        </span>
      </span>
      <button
        type="button"
        onClick={() => armSample(null)}
        aria-label="cancel stamping"
        className="shrink-0 h-7 px-2 rounded border border-neon-violet/40 hover:border-neon-violet hover:bg-neon-violet/20 transition-colors duration-150 motion-reduce:transition-none"
      >
        esc · cancel
      </button>
    </div>
  );
}
