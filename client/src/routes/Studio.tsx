import { useEffect } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";
import { startPatternBridge } from "@/audio/bridge";
import { TransportBar } from "@/features/studio/TransportBar";
import { StepGrid } from "@/features/studio/StepGrid";
import { SampleRow } from "@/features/studio/SampleRow";
import { useSpaceToPlay } from "@/features/studio/useSpaceToPlay";

export default function StudioRoute() {
  const audioReady = useBeatsStore((s) => s.transport.audioReady);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);
  const tracks = useBeatsStore((s) => s.pattern.tracks);
  useSpaceToPlay();

  // Start the store ↔ engine bridge once the engine is running. The bridge
  // primes the engine with the current pattern and subscribes to future changes.
  useEffect(() => {
    if (!audioReady) return;
    const unsubscribe = startPatternBridge();
    return unsubscribe;
  }, [audioReady]);

  return (
    <div className="py-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1
            className="text-neon-cyan text-2xl tracking-[0.4em] uppercase"
            style={{ textShadow: "var(--glow-cyan)" }}
          >
            studio
          </h1>
          <p className="text-ink-muted text-xs uppercase tracking-widest mt-1">
            tap a step, pick a sample, press play
          </p>
        </div>
        {!audioReady && (
          <button
            type="button"
            onClick={() => void ensureEngineStarted()}
            className="px-4 h-10 border border-neon-violet text-neon-violet rounded text-xs uppercase tracking-widest hover:bg-neon-violet hover:text-bg-void transition-colors duration-200 ease-in"
          >
            prime audio
          </button>
        )}
      </header>

      <TransportBar />

      <StepGrid />

      <section className="space-y-4">
        <h2 className="text-ink-muted text-xs uppercase tracking-widest">
          samples
        </h2>
        <div className="space-y-3">
          {tracks.map((track) => (
            <div
              key={track.id}
              className="grid grid-cols-[90px_1fr] items-start gap-3"
            >
              <span className="text-xs uppercase tracking-widest text-ink-muted pt-1">
                {track.kind}
              </span>
              <SampleRow trackId={track.id} kind={track.kind} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
