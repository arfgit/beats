import { useBeatsStore } from "@/store/useBeatsStore";
import { EffectCard } from "./EffectCard";

export function EffectsRack() {
  const effects = useBeatsStore((s) => s.pattern.effects);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {effects.map((effect) => (
        <EffectCard key={effect.kind} effect={effect} />
      ))}
    </div>
  );
}
