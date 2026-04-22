import { useEffect, useRef } from "react";
import clsx from "clsx";
import { useParams } from "react-router-dom";
import { nanoid } from "nanoid";
import { useBeatsStore } from "@/store/useBeatsStore";
import { startPatternBridge } from "@/audio/bridge";
import { acquireLock, type MultiTabLock } from "@/lib/multiTabLock";
import { TransportBar } from "@/features/studio/TransportBar";
import { TrackRow } from "@/features/studio/TrackRow";
import { MatrixGrid } from "@/features/studio/MatrixGrid";
import { EffectsRack } from "@/features/studio/EffectsRack";
import { RecorderPanel } from "@/features/studio/RecorderPanel";
import { SaveShareBar } from "@/features/studio/SaveShareBar";
import { ProjectList } from "@/features/studio/ProjectList";
import { PeerCursors } from "@/features/studio/PeerCursors";
import { useSpaceToPlay } from "@/features/studio/useSpaceToPlay";
import { useUndoShortcuts } from "@/features/studio/useUndoShortcuts";

export default function StudioRoute() {
  const { projectId } = useParams<{ projectId?: string }>();
  const audioReady = useBeatsStore((s) => s.transport.audioReady);
  const priming = useBeatsStore((s) => s.transport.priming);
  const lastAudioError = useBeatsStore((s) => s.transport.lastError);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);
  const tracks = useBeatsStore((s) => s.pattern.tracks);
  const loadProject = useBeatsStore((s) => s.loadProject);
  const clearProject = useBeatsStore((s) => s.clearProject);
  const setLockOwner = useBeatsStore((s) => s.setLockOwner);
  const flushPendingQueue = useBeatsStore((s) => s.flushPendingQueue);
  const startCollab = useBeatsStore((s) => s.startCollab);
  const stopCollab = useBeatsStore((s) => s.stopCollab);
  const authedUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  useSpaceToPlay();
  useUndoShortcuts();

  const tabIdRef = useRef<string>(nanoid(8));

  useEffect(() => {
    // Mount the bridge pre-gesture so sample buffers fetch + decode into
    // the shared SamplePool on load. Post-gesture the same bridge also
    // wires pattern/voice state onto the live audio graph. The bridge
    // checks audioEngine.isStarted() internally to gate each phase.
    const unsubscribe = startPatternBridge();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let lock: MultiTabLock | null = null;
    if (projectId) {
      void loadProject(projectId);
      lock = acquireLock(projectId, tabIdRef.current);
      lock.onChange(setLockOwner);
      if (authedUid) startCollab(projectId);
    } else {
      clearProject();
      setLockOwner(true);
      stopCollab();
    }
    return () => {
      lock?.release();
      stopCollab();
      clearProject();
    };
  }, [
    projectId,
    authedUid,
    loadProject,
    clearProject,
    setLockOwner,
    startCollab,
    stopCollab,
  ]);

  useEffect(() => {
    const handler = () => void flushPendingQueue();
    window.addEventListener("online", handler);
    void flushPendingQueue();
    return () => window.removeEventListener("online", handler);
  }, [flushPendingQueue]);

  return (
    <div
      className={clsx(
        "py-6 lg:py-8 grid gap-6 lg:gap-8",
        authedUid
          ? "grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]"
          : "grid-cols-1",
      )}
    >
      {authedUid && <ProjectList />}
      <div className="space-y-6">
        <header className="flex items-end justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-ink text-lg tracking-[0.3em] uppercase font-normal">
              <span className="text-neon-cyan">/</span> studio
            </h1>
            <p className="text-ink-muted text-[10px] uppercase tracking-widest mt-1">
              tap a step · pick a sample · engage an effect · hit play
            </p>
          </div>
          <div className="flex items-center gap-4">
            <PeerCursors />
            {audioReady ? (
              <span
                className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-ink-muted"
                aria-live="polite"
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-neon-green"
                />
                audio ready
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void ensureEngineStarted()}
                disabled={priming}
                className="px-4 h-10 border border-neon-violet/70 text-neon-violet rounded text-xs uppercase tracking-widest hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-60 disabled:cursor-wait"
              >
                {priming
                  ? "priming…"
                  : lastAudioError
                    ? "retry audio"
                    : "prime audio"}
              </button>
            )}
          </div>
        </header>

        <TransportBar />
        <SaveShareBar />

        <MatrixGrid />

        <section className="border border-grid rounded bg-bg-panel/50 p-4 lg:p-6">
          {tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} />
          ))}
        </section>

        <EffectsRack />
        <RecorderPanel />
      </div>
    </div>
  );
}
