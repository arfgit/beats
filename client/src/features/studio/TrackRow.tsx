import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";
import { useStep } from "./useStep";
import { SampleRow } from "./SampleRow";
import type { Track } from "@beats/shared";

const trackAccents: Record<string, string> = {
  "track-drums": "text-neon-magenta border-neon-magenta",
  "track-bass": "text-neon-sun border-neon-sun",
  "track-guitar": "text-neon-cyan border-neon-cyan",
  "track-vocals": "text-neon-violet border-neon-violet",
};

const stepActiveBg: Record<string, string> = {
  "track-drums": "bg-neon-magenta/80 border-neon-magenta",
  "track-bass": "bg-neon-sun/80 border-neon-sun",
  "track-guitar": "bg-neon-cyan/80 border-neon-cyan",
  "track-vocals": "bg-neon-violet/80 border-neon-violet",
};

interface Props {
  track: Track;
}

export function TrackRow({ track }: Props) {
  const toggleStep = useBeatsStore((s) => s.toggleStep);
  const toggleMute = useBeatsStore((s) => s.toggleMute);
  const toggleSolo = useBeatsStore((s) => s.toggleSolo);
  const setTrackGain = useBeatsStore((s) => s.setTrackGain);
  const currentStep = useStep();
  const isPlaying = useBeatsStore((s) => s.transport.isPlaying);

  const accent = trackAccents[track.id] ?? "text-ink";
  const activeBg =
    stepActiveBg[track.id] ?? "bg-neon-magenta/20 border-neon-magenta";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-start py-2 border-b border-grid/40 last:border-0">
      <div className="flex flex-col gap-1.5">
        <span
          className={clsx(
            "text-xs uppercase tracking-widest",
            accent.split(" ")[0],
          )}
        >
          {track.kind}
        </span>
        <div className="flex items-center gap-1.5">
          <Tooltip label={track.muted ? "unmute" : "mute this track"}>
            <button
              type="button"
              onClick={() => toggleMute(track.id)}
              aria-pressed={track.muted}
              className={clsx(
                "h-7 w-7 rounded border text-[10px] font-mono uppercase",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                track.muted
                  ? "border-neon-red text-neon-red bg-neon-red/10"
                  : "border-grid text-ink-muted hover:border-neon-red hover:text-neon-red",
              )}
            >
              m
            </button>
          </Tooltip>
          <Tooltip label={track.soloed ? "un-solo" : "solo this track"}>
            <button
              type="button"
              onClick={() => toggleSolo(track.id)}
              aria-pressed={track.soloed}
              className={clsx(
                "h-7 w-7 rounded border text-[10px] font-mono uppercase",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                track.soloed
                  ? "border-neon-sun text-neon-sun bg-neon-sun/10"
                  : "border-grid text-ink-muted hover:border-neon-sun hover:text-neon-sun",
              )}
            >
              s
            </button>
          </Tooltip>
          <Tooltip label={`gain ${Math.round(track.gain * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={track.gain}
              onChange={(e) => setTrackGain(track.id, Number(e.target.value))}
              aria-label={`${track.kind} gain`}
              className="flex-1 h-1 appearance-none bg-grid rounded accent-neon-magenta cursor-pointer"
            />
          </Tooltip>
        </div>
        <SampleRow trackId={track.id} kind={track.kind} />
      </div>

      <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
        {track.steps.map((step, i) => {
          const isCurrent = isPlaying && currentStep === i;
          const velocityScale = 0.4 + step.velocity * 0.6;
          return (
            <Tooltip
              key={i}
              label={`step ${i + 1}${step.active ? " · on" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleStep(track.id, i)}
                aria-pressed={step.active}
                aria-label={`${track.kind} step ${i + 1}`}
                style={{ opacity: step.active ? velocityScale : 1 }}
                className={clsx(
                  "aspect-square min-h-[32px] rounded-sm border transition-colors duration-150 ease-in",
                  "motion-reduce:transition-none",
                  step.active
                    ? activeBg
                    : "bg-bg-panel-2/40 border-grid hover:border-neon-violet",
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
}
