import clsx from "clsx";
import type { TrackKind } from "@beats/shared";
import { samplesByKind } from "@/data/builtinSamples";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";

interface Props {
  trackId: string;
  kind: TrackKind;
}

export function SampleRow({ trackId, kind }: Props) {
  const currentSampleId = useBeatsStore(
    (s) => s.pattern.tracks.find((t) => t.id === trackId)?.sampleId ?? null,
  );
  const setTrackSample = useBeatsStore((s) => s.setTrackSample);
  const samples = samplesByKind(kind);

  return (
    <div className="flex flex-wrap gap-1.5">
      {samples.map((sample) => {
        const active = sample.id === currentSampleId;
        return (
          <Tooltip
            key={sample.id}
            label={`${sample.name} · ${sample.durationMs}ms`}
          >
            <button
              type="button"
              onClick={() => setTrackSample(trackId, sample.id, sample.version)}
              aria-pressed={active}
              className={clsx(
                "px-2.5 py-1 rounded border font-mono text-[10px] uppercase tracking-widest",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                active
                  ? "border-neon-cyan text-neon-cyan bg-neon-cyan/10"
                  : "border-grid text-ink-muted hover:border-neon-cyan hover:text-neon-cyan",
              )}
            >
              {sample.name}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
