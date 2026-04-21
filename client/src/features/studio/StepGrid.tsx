import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";
import { useStep } from "./useStep";

const trackLabels: Record<string, { label: string; accent: string }> = {
  "track-drums": { label: "drums", accent: "text-neon-magenta" },
  "track-bass": { label: "bass", accent: "text-neon-sun" },
  "track-guitar": { label: "guitar", accent: "text-neon-cyan" },
  "track-vocals": { label: "vocals", accent: "text-neon-violet" },
};

export function StepGrid() {
  const tracks = useBeatsStore((s) => s.pattern.tracks);
  const toggleStep = useBeatsStore((s) => s.toggleStep);
  const currentStep = useStep();
  const isPlaying = useBeatsStore((s) => s.transport.isPlaying);

  return (
    <div className="border border-grid rounded bg-bg-panel/50 p-4 space-y-2">
      {tracks.map((track) => {
        const meta = trackLabels[track.id] ?? {
          label: track.kind,
          accent: "text-ink",
        };
        return (
          <div
            key={track.id}
            className="grid grid-cols-[90px_1fr] items-center gap-3"
          >
            <span
              className={clsx("text-xs uppercase tracking-widest", meta.accent)}
            >
              {meta.label}
            </span>
            <div className="grid grid-cols-8 gap-1.5">
              {track.steps.map((step, i) => {
                const isCurrent = isPlaying && currentStep === i;
                return (
                  <Tooltip
                    key={i}
                    label={`step ${i + 1}${step.active ? " (on)" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleStep(track.id, i)}
                      aria-pressed={step.active}
                      aria-label={`${meta.label} step ${i + 1}`}
                      className={clsx(
                        "aspect-square rounded border transition-colors duration-150 ease-in",
                        "motion-reduce:transition-none",
                        step.active
                          ? "bg-neon-magenta/20 border-neon-magenta text-neon-magenta shadow-[var(--glow-magenta)]"
                          : "bg-bg-panel-2/40 border-grid text-ink-muted hover:border-neon-violet",
                        isCurrent &&
                          "ring-2 ring-neon-cyan ring-offset-2 ring-offset-bg-panel",
                      )}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
