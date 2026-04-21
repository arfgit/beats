import clsx from "clsx";
import type { EffectKind, EffectState } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Knob } from "@/components/ui/Knob";
import { Tooltip } from "@/components/ui/Tooltip";

const effectMeta: Record<
  EffectKind,
  { title: string; description: string; params: ParamSpec[] }
> = {
  chorus: {
    title: "chorus",
    description: "Widens the stereo image with a slow LFO-modulated delay.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.1,
        max: 8,
        step: 0.1,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "depth",
        label: "depth",
        min: 0,
        max: 1,
        step: 0.01,
        display: (v) => `${Math.round(v * 100)}%`,
      },
    ],
  },
  phaser: {
    title: "phaser",
    description: "All-pass filter sweep — classic synthwave whoosh.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.1,
        max: 5,
        step: 0.1,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "octaves",
        label: "range",
        min: 1,
        max: 6,
        step: 1,
        display: (v) => v.toFixed(0),
      },
    ],
  },
  tremolo: {
    title: "tremolo",
    description: "Amplitude modulation — rhythmic pulse.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.5,
        max: 20,
        step: 0.5,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "depth",
        label: "depth",
        min: 0,
        max: 1,
        step: 0.01,
        display: (v) => `${Math.round(v * 100)}%`,
      },
    ],
  },
  moogFilter: {
    title: "moog",
    description: "24dB/oct lowpass with resonance. True-bypass via cross-fade.",
    params: [
      {
        key: "cutoff",
        label: "cutoff",
        min: 80,
        max: 20000,
        step: 10,
        display: (v) => `${Math.round(v)}hz`,
      },
      {
        key: "resonance",
        label: "reso",
        min: 0.1,
        max: 20,
        step: 0.1,
        display: (v) => v.toFixed(1),
      },
    ],
  },
};

interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  display: (v: number) => string;
}

interface Props {
  effect: EffectState;
}

export function EffectCard({ effect }: Props) {
  const meta = effectMeta[effect.kind];
  const toggleEffect = useBeatsStore((s) => s.toggleEffect);
  const setEffectParam = useBeatsStore((s) => s.setEffectParam);

  return (
    <div
      className={clsx(
        "border rounded p-3 bg-bg-panel/60 space-y-3",
        effect.enabled ? "border-neon-violet" : "border-grid",
      )}
    >
      <div className="flex items-center justify-between">
        <Tooltip label={meta.description} placement="top">
          <span className="text-xs uppercase tracking-widest text-ink">
            {meta.title}
          </span>
        </Tooltip>
        <Tooltip label={effect.enabled ? "bypass" : "engage"}>
          <button
            type="button"
            role="switch"
            aria-checked={effect.enabled}
            aria-label={`${meta.title} ${effect.enabled ? "on" : "off"}`}
            onClick={() => toggleEffect(effect.kind)}
            className={clsx(
              "h-6 w-11 rounded-full border transition-colors duration-200 ease-in",
              "motion-reduce:transition-none relative",
              effect.enabled
                ? "bg-neon-violet/30 border-neon-violet"
                : "bg-bg-panel-2 border-grid",
            )}
          >
            <span
              className={clsx(
                "absolute top-0.5 h-4 w-4 rounded-full transition-transform duration-200 ease-in",
                "motion-reduce:transition-none",
                effect.enabled
                  ? "translate-x-[22px] bg-neon-violet shadow-[var(--glow-violet)]"
                  : "translate-x-1 bg-ink-muted",
              )}
            />
          </button>
        </Tooltip>
      </div>
      <div className="flex justify-around">
        {meta.params.map((param) => (
          <Knob
            key={param.key}
            label={param.label}
            value={effect.params[param.key] ?? param.min}
            min={param.min}
            max={param.max}
            step={param.step}
            onChange={(v) => setEffectParam(effect.kind, param.key, v)}
            valueDisplay={param.display}
          />
        ))}
      </div>
    </div>
  );
}
