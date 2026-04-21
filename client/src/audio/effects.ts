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
      applyWet(chain.chorus.wet, effect);
      rampSignal(chain.chorus.frequency, effect.params.frequency);
      // Chorus.depth is a plain number accessor in Tone 15, not a Signal
      if (isFinite(effect.params.depth))
        chain.chorus.depth = effect.params.depth!;
      return;
    case "phaser":
      applyWet(chain.phaser.wet, effect);
      rampSignal(chain.phaser.frequency, effect.params.frequency);
      // Phaser.octaves is a plain number accessor
      if (isFinite(effect.params.octaves))
        chain.phaser.octaves = effect.params.octaves!;
      return;
    case "tremolo":
      applyWet(chain.tremolo.wet, effect);
      rampSignal(chain.tremolo.frequency, effect.params.frequency);
      rampSignal(chain.tremolo.depth, effect.params.depth);
      return;
    case "moogFilter":
      applyMoogBypass(chain, effect);
      rampSignal(chain.moogFilter.frequency, effect.params.cutoff);
      rampSignal(chain.moogFilter.Q, effect.params.resonance);
      return;
  }
}

function applyWet(
  signal: Tone.Signal<"normalRange">,
  effect: EngineEffectSnapshot,
): void {
  const target = effect.enabled ? (effect.params.wet ?? 0.5) : 0;
  signal.rampTo(target, BYPASS_RAMP_SEC);
}

function applyMoogBypass(
  chain: EffectsChain,
  effect: EngineEffectSnapshot,
): void {
  chain.moogCrossFade.fade.rampTo(effect.enabled ? 1 : 0, BYPASS_RAMP_SEC);
}

function rampSignal(
  signal: Tone.Signal<Tone.UnitName>,
  value: number | undefined,
): void {
  if (!isFinite(value)) return;
  signal.rampTo(value!, BYPASS_RAMP_SEC);
}

function isFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export const EFFECT_ORDER: ReadonlyArray<EffectKind> = [
  "chorus",
  "phaser",
  "tremolo",
  "moogFilter",
];
