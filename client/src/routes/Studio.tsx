import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";
import { startPatternBridge } from "@/audio/bridge";
import { TransportBar } from "@/features/studio/TransportBar";
import { TrackRow } from "@/features/studio/TrackRow";
import { EffectsRack } from "@/features/studio/EffectsRack";
import { RecorderPanel } from "@/features/studio/RecorderPanel";
import { useSpaceToPlay } from "@/features/studio/useSpaceToPlay";
import { useUndoShortcuts } from "@/features/studio/useUndoShortcuts";

export default function StudioRoute() {
  const audioReady = useBeatsStore((s) => s.transport.audioReady);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);
  const tracks = useBeatsStore((s) => s.pattern.tracks);
  useSpaceToPlay();
  useUndoShortcuts();

  useEffect(() => {
    if (!audioReady) return;
    const unsubscribe = startPatternBridge();
    return unsubscribe;
  }, [audioReady]);

  return (
    <div className="py-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1
            className="text-neon-cyan text-2xl tracking-[0.4em] uppercase"
            style={{ textShadow: "var(--glow-cyan)" }}
          >
            studio
          </h1>
          <p className="text-ink-muted text-xs uppercase tracking-widest mt-1">
            tap a step · pick a sample · engage an effect · hit play
          </p>
        </div>
        {!audioReady && (
          <button
            type="button"
            onClick={() => void ensureEngineStarted()}
            className="px-4 h-10 border border-neon-violet text-neon-violet rounded text-xs uppercase tracking-widest hover:bg-neon-violet hover:text-bg-void transition-colors duration-200 ease-in motion-reduce:transition-none"
          >
            prime audio
          </button>
        )}
      </header>

      <TransportBar />

      <section className="border border-grid rounded bg-bg-panel/50 p-4">
        {tracks.map((track) => (
          <TrackRow key={track.id} track={track} />
        ))}
      </section>

      <EffectsRack />

      <RecorderPanel />
    </div>
  );
}
