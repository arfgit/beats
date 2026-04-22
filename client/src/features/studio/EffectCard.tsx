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
    description:
      "Makes one sound feel like many — blends subtle pitch-shifted copies for a thicker, wider vocal or guitar. Mix: how loud the effect is. Rate: how fast it sweeps. Depth: how dramatic the pitch shift.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.1,
        max: 8,
        step: 0.1,
        defaultValue: 1.5,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "depth",
        label: "depth",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        display: (v) => `${Math.round(v * 100)}%`,
      },
    ],
  },
  phaser: {
    title: "phaser",
    description:
      "Whooshy sweep that moves peaks through the frequency spectrum — great for pads, guitars, or adding motion to a static part. Mix: effect strength. Rate: sweep speed. Range: how wide the sweep goes.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.1,
        max: 5,
        step: 0.1,
        defaultValue: 0.5,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "octaves",
        label: "range",
        min: 1,
        max: 6,
        step: 1,
        defaultValue: 3,
        display: (v) => v.toFixed(0),
      },
    ],
  },
  tremolo: {
    title: "tremolo",
    description:
      "Rapidly turns the volume up and down for a pulsing, choppy feel — classic on surf guitars and synth leads. Mix: effect strength. Rate: pulse speed (try matching your BPM). Depth: how far it dips between pulses.",
    params: [
      {
        key: "wet",
        label: "mix",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        display: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "frequency",
        label: "rate",
        min: 0.5,
        max: 20,
        step: 0.5,
        defaultValue: 5,
        display: (v) => `${v.toFixed(1)}hz`,
      },
      {
        key: "depth",
        label: "depth",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
        display: (v) => `${Math.round(v * 100)}%`,
      },
    ],
  },
  moogFilter: {
    title: "moog",
    description:
      "Cuts high frequencies to make sounds darker and warmer, or sweep the cutoff for classic acid-bass squelch. Cutoff: the frequency above which sound is removed. Reso: emphasis at the cutoff point — high values get whistly and aggressive.",
    params: [
      {
        key: "cutoff",
        label: "cutoff",
        min: 80,
        max: 20000,
        step: 10,
        defaultValue: 1200,
        display: (v) => `${Math.round(v)}hz`,
      },
      {
        key: "resonance",
        label: "reso",
        min: 0.1,
        max: 20,
        step: 0.1,
        defaultValue: 1,
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
  defaultValue: number;
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
              "relative shrink-0 inline-flex items-center",
              "h-7 w-14 rounded-full border px-1",
              "transition-colors duration-200 ease-in motion-reduce:transition-none",
              effect.enabled
                ? "bg-neon-violet/25 border-neon-violet"
                : "bg-bg-panel-2 border-grid",
            )}
          >
            {/* small OFF / ON text for extra clarity at small sizes */}
            <span
              className={clsx(
                "absolute inset-0 flex items-center justify-between px-2 text-[8px] font-mono uppercase tracking-widest pointer-events-none",
                effect.enabled ? "text-neon-violet" : "text-ink-muted",
              )}
            >
              <span className={effect.enabled ? "opacity-100" : "opacity-0"}>
                on
              </span>
              <span className={effect.enabled ? "opacity-0" : "opacity-100"}>
                off
              </span>
            </span>
            <span
              className={clsx(
                "relative h-5 w-5 rounded-full transition-transform duration-200 ease-in",
                "motion-reduce:transition-none",
                effect.enabled
                  ? "translate-x-[26px] bg-neon-violet"
                  : "translate-x-0 bg-ink-dim",
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
            value={effect.params[param.key] ?? param.defaultValue}
            min={param.min}
            max={param.max}
            step={param.step}
            defaultValue={param.defaultValue}
            onChange={(v) => setEffectParam(effect.kind, param.key, v)}
            valueDisplay={param.display}
          />
        ))}
      </div>
    </div>
  );
}
