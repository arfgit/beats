import * as Tone from "tone";
import type { EffectKind } from "@beats/shared";
import type { EngineEffectSnapshot } from "./snapshot";

/**
 * Master-bus effects chain. Fixed order: Chorus → Phaser → Tremolo → Moog.
 *
 * Chorus/Phaser/Tremolo use native `wet` signal for bypass (real wet/dry).
 * Moog (Tone.Filter) has no wet param, so it lives behind a CrossFade:
 *   input → splitter →(dry)→ crossFade.a ──┐
 *                   →(filter)→ crossFade.b ─┤→ output
 *   crossFade.fade controlled by `enabled` (ramped 20ms).
 *
 * All toggles ramp to avoid clicks.
 */
export interface EffectsChain {
  readonly input: Tone.InputNode;
  readonly output: Tone.OutputNode;
  readonly chorus: Tone.Chorus;
  readonly phaser: Tone.Phaser;
  readonly tremolo: Tone.Tremolo;
  readonly moogFilter: Tone.Filter;
  readonly moogCrossFade: Tone.CrossFade;
  dispose: () => void;
}

const BYPASS_RAMP_SEC = 0.02;

export function createEffectsChain(): EffectsChain {
  const chorus = new Tone.Chorus({
    frequency: 1.5,
    depth: 0.5,
    wet: 0,
  }).start();
  const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, wet: 0 });
  const tremolo = new Tone.Tremolo({
    frequency: 5,
    depth: 0.5,
    wet: 0,
  }).start();
  const moogFilter = new Tone.Filter({
    type: "lowpass",
    frequency: 1200,
    Q: 1,
    rolloff: -24,
  });
  const moogCrossFade = new Tone.CrossFade(0); // 0 = dry, 1 = filtered

  // chain the three wet/dry-safe effects in series
  chorus.chain(phaser, tremolo);

  // Tremolo → splitter → (dry path → crossFade.a), (filter path → crossFade.b)
  tremolo.fan(moogCrossFade.a, moogFilter);
  moogFilter.connect(moogCrossFade.b);

  return {
    input: chorus,
    output: moogCrossFade,
    chorus,
    phaser,
    tremolo,
    moogFilter,
    moogCrossFade,
    dispose: () => {
      chorus.dispose();
      phaser.dispose();
      tremolo.dispose();
      moogFilter.dispose();
      moogCrossFade.dispose();
    },
  };
}

export function applyEffectSnapshot(
  chain: EffectsChain,
  effect: EngineEffectSnapshot,
): void {
  switch (effect.kind) {
    case "chorus":
      applyWetParam(chain.chorus.wet, effect, "wet");
      setIfPresent(chain.chorus.frequency, effect.params.frequency);
      setIfPresent(chain.chorus.depth, effect.params.depth);
      return;
    case "phaser":
      applyWetParam(chain.phaser.wet, effect, "wet");
      setIfPresent(chain.phaser.frequency, effect.params.frequency);
      if (typeof effect.params.octaves === "number")
        chain.phaser.octaves = effect.params.octaves;
      return;
    case "tremolo":
      applyWetParam(chain.tremolo.wet, effect, "wet");
      setIfPresent(chain.tremolo.frequency, effect.params.frequency);
      setIfPresent(chain.tremolo.depth, effect.params.depth);
      return;
    case "moogFilter":
      applyMoogBypass(chain, effect);
      setIfPresent(chain.moogFilter.frequency, effect.params.cutoff);
      if (typeof effect.params.resonance === "number")
        chain.moogFilter.Q.value = effect.params.resonance;
      return;
  }
}

function applyWetParam(
  signal: Tone.Signal<"normalRange">,
  effect: EngineEffectSnapshot,
  key: string,
): void {
  const target = effect.enabled ? (effect.params[key] ?? 0.5) : 0;
  signal.rampTo(target, BYPASS_RAMP_SEC);
}

function applyMoogBypass(
  chain: EffectsChain,
  effect: EngineEffectSnapshot,
): void {
  const target = effect.enabled ? 1 : 0;
  chain.moogCrossFade.fade.rampTo(target, BYPASS_RAMP_SEC);
}

function setIfPresent(
  param: Tone.Param<Tone.UnitName>,
  value: number | undefined,
): void {
  if (typeof value === "number" && Number.isFinite(value))
    param.rampTo(value, BYPASS_RAMP_SEC);
}

export const EFFECT_ORDER: ReadonlyArray<EffectKind> = [
  "chorus",
  "phaser",
  "tremolo",
  "moogFilter",
];
