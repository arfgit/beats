import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import clsx from "clsx";
import { useLocation, useParams } from "react-router-dom";
import { TRACK_KINDS, type TrackKind } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { startPatternBridge } from "@/audio/bridge";
import { rehydrateFromLocalCache } from "@/lib/localCache";
import { acquireLock, type MultiTabLock } from "@/lib/multiTabLock";
import { TransportBar } from "@/features/studio/TransportBar";
import { TrackRow } from "@/features/studio/TrackRow";
import { MatrixGrid } from "@/features/studio/MatrixGrid";
import { Tooltip } from "@/components/ui/Tooltip";
import { EffectsRack } from "@/features/studio/EffectsRack";
import { RecorderPanel } from "@/features/studio/RecorderPanel";
import { SaveShareBar } from "@/features/studio/SaveShareBar";
import { ProjectList } from "@/features/studio/ProjectList";
import { PeerCursors } from "@/features/studio/PeerCursors";
import { useSpaceToPlay } from "@/features/studio/useSpaceToPlay";
import { useUndoShortcuts } from "@/features/studio/useUndoShortcuts";
import { useDisarmOnEscape } from "@/features/studio/useDisarmOnEscape";
import { ArmedBanner } from "@/features/studio/ArmedBanner";
import {
  PeerCursorOverlay,
  SessionParticipantRail,
} from "@/features/studio/PeerCursorOverlay";
import { useCursorBroadcast } from "@/features/studio/useCursorBroadcast";
import { SessionInviteDialog } from "@/features/studio/SessionInviteDialog";
import { SessionJoinPrompt } from "@/features/studio/SessionJoinPrompt";
import { getRememberedSession } from "@/lib/session-memory";

export default function StudioRoute() {
  const { projectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  // Detect a session-join URL up front. When `?session=<id>` is present
  // we DEFER project hydration: the invitee almost certainly isn't on
  // the project's collaborator list, and a Firestore onSnapshot to a
  // project they can't read fires `permission-denied` in a loop until
  // the listener is detached. Let `SessionJoinPrompt` → `joinSession`
  // hydrate state via the server response + RTDB listeners instead.
  const joiningSessionId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("session");
  }, [location.search]);
  const audioReady = useBeatsStore((s) => s.transport.audioReady);
  const priming = useBeatsStore((s) => s.transport.priming);
  const lastAudioError = useBeatsStore((s) => s.transport.lastError);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);
  const tracks = useBeatsStore((s) => s.pattern.tracks);
  const clearAllSteps = useBeatsStore((s) => s.clearAllSteps);
  const audioSuspended = useBeatsStore((s) => s.transport.audioSuspended);
  const resumeFromSuspension = useBeatsStore((s) => s.resumeFromSuspension);
  const addTrack = useBeatsStore((s) => s.addTrack);
  const selectedCellId = useBeatsStore((s) => s.selectedCellId);
  const syncPatternIntoMatrix = useBeatsStore((s) => s.syncPatternIntoMatrix);
  const loadCellIntoPattern = useBeatsStore((s) => s.loadCellIntoPattern);
  const [newRowKind, setNewRowKind] = useState<TrackKind>("drums");
  const [mixerOpen, setMixerOpen] = useState(true);
  const loadProject = useBeatsStore((s) => s.loadProject);
  const clearProject = useBeatsStore((s) => s.clearProject);
  const setLockOwner = useBeatsStore((s) => s.setLockOwner);
  const flushPendingQueue = useBeatsStore((s) => s.flushPendingQueue);
  const startCollab = useBeatsStore((s) => s.startCollab);
  const stopCollab = useBeatsStore((s) => s.stopCollab);
  const authedUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  useSpaceToPlay();
  useUndoShortcuts();
  useDisarmOnEscape();
  // Auto-prime audio on the first user gesture inside the studio.
  // Browser autoplay policy requires a user gesture before the
  // AudioContext can resume; without this hook the user has to click
  // the explicit "prime audio" button before anything sounds. With
  // it, ANY click/keypress in the studio (toggling a step, picking a
  // sample, etc.) primes audio in the same gesture. Listener removes
  // itself on first fire so we don't repeatedly call ensureEngineStarted.
  useEffect(() => {
    if (audioReady) return;
    let primed = false;
    const onGesture = () => {
      if (primed) return;
      primed = true;
      void ensureEngineStarted();
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
  }, [audioReady, ensureEngineStarted]);
  // Surface ref drives both local cursor broadcast (we report normalized
  // [0,1] coords against this rect) and remote cursor projection (peers'
  // normalized coords project back into this rect's pixel space). Same
  // element on both sides keeps everyone's cursor at the same logical
  // spot regardless of viewport size.
  const cursorSurfaceRef = useRef<HTMLDivElement>(null);
  useCursorBroadcast(cursorSurfaceRef);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const liveSessionId = useBeatsStore((s) => s.collab.session.id);
  const loadedProjectId = useBeatsStore((s) => s.project.current?.id ?? null);
  const joinSession = useBeatsStore((s) => s.joinSession);
  // Global close-all-popups signal — bumped on invite accept etc.
  const popupCloseTrigger = useBeatsStore((s) => s.ui.popupCloseTrigger);
  useEffect(() => {
    if (popupCloseTrigger === 0) return;
    setSessionDialogOpen(false);
  }, [popupCloseTrigger]);

  // Refresh-survivability: if this tab was in a session for the
  // current project before the refresh, silently re-attach. This
  // covers the host's path (URL has no ?session= because they
  // started, not joined) AND a stale invitee whose URL was
  // already-stripped. Invitees with `?session=` go through
  // SessionJoinPrompt's own silent-rejoin which uses the same memory.
  useEffect(() => {
    if (!authedUid || !projectId || joiningSessionId) return;
    if (liveSessionId) return;
    const remembered = getRememberedSession(projectId);
    if (!remembered) return;
    void joinSession(remembered);
  }, [authedUid, projectId, joiningSessionId, liveSessionId, joinSession]);

  // Sidebar "go live on this project" handoff. ProjectList nav-pushes
  // `/studio/<id>?goLive=1`; once the project hydrates and we're not
  // already in a session, kick off startSession and strip the flag so
  // a refresh doesn't re-fire the start.
  const goLiveRequested = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("goLive") === "1";
  }, [location.search]);
  const startSession = useBeatsStore((s) => s.startSession);
  useEffect(() => {
    if (!goLiveRequested) return;
    if (!authedUid || !projectId) return;
    if (liveSessionId) return;
    if (loadedProjectId !== projectId) return;
    void startSession(projectId).finally(() => {
      const params = new URLSearchParams(window.location.search);
      params.delete("goLive");
      const next = params.toString();
      const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
      window.history.replaceState({}, "", url);
    });
  }, [
    goLiveRequested,
    authedUid,
    projectId,
    liveSessionId,
    loadedProjectId,
    startSession,
  ]);

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
    if (projectId && !joiningSessionId) {
      void loadProject(projectId);
      lock = acquireLock(projectId, tabIdRef.current);
      lock.onChange(setLockOwner);
      if (authedUid) startCollab(projectId);
    } else if (projectId && joiningSessionId) {
      // Joining a session: the invitee may not have project read
      // access. Skip Firestore hydration entirely; the join handler
      // returns the canonical state from the server (which uses
      // Admin SDK creds) and the RTDB listeners take over from there.
      // We still acquire the multi-tab lock so two tabs of the same
      // user don't both broadcast cursor + presence.
      lock = acquireLock(projectId, tabIdRef.current);
      lock.onChange(setLockOwner);
    } else {
      // Restore any unsaved anon work from the previous session before
      // clearing project-level state. rehydrate is a no-op when no cache
      // exists, so a fresh visit still starts from defaults.
      rehydrateFromLocalCache();
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
    joiningSessionId,
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
      {audioSuspended && (
        <div
          role="status"
          aria-live="assertive"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded border border-neon-sun bg-bg-panel shadow-[var(--glow-sun)]"
        >
          <span className="text-ink text-xs uppercase tracking-widest">
            audio paused while the tab was hidden
          </span>
          <button
            type="button"
            onClick={() => void resumeFromSuspension()}
            className="h-8 px-3 border border-neon-sun text-neon-sun rounded text-[11px] uppercase tracking-widest font-mono hover:bg-neon-sun/10 transition-colors duration-200 ease-in motion-reduce:transition-none"
          >
            tap to resume
          </button>
        </div>
      )}
      <div ref={cursorSurfaceRef} className="space-y-6 relative">
        <PeerCursorOverlay surface={cursorSurfaceRef} />
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
            <SessionParticipantRail />
            <PeerCursors />
            {authedUid && (
              <Tooltip
                label={
                  liveSessionId
                    ? "manage live session"
                    : loadedProjectId
                      ? "start a live collab session"
                      : "save your project to start a live session"
                }
              >
                <button
                  type="button"
                  onClick={() => setSessionDialogOpen(true)}
                  aria-label="live session"
                  className={clsx(
                    "h-8 px-3 rounded border text-[10px] uppercase tracking-widest font-mono transition-colors duration-150 motion-reduce:transition-none flex items-center gap-1.5",
                    liveSessionId
                      ? "border-neon-green text-neon-green bg-neon-green/10 hover:bg-neon-green/20"
                      : "border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet",
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      liveSessionId
                        ? "bg-neon-green animate-pulse"
                        : "bg-ink-muted",
                    )}
                  />
                  {liveSessionId ? "live" : "go live"}
                </button>
              </Tooltip>
            )}
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
        <ArmedBanner />

        <MatrixGrid />

        <section className="border border-grid rounded bg-bg-panel/50 p-4 lg:p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-ink-muted text-xs uppercase tracking-widest">
              grid
            </h2>
            <Tooltip label="deactivate every step on every row of the current cell">
              <button
                type="button"
                onClick={clearAllSteps}
                className="h-7 px-2 rounded border border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet text-[10px] uppercase tracking-widest font-mono transition-colors duration-200 ease-in motion-reduce:transition-none"
              >
                clear all
              </button>
            </Tooltip>
          </div>
          {tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} />
          ))}
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-grid/40">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              add row
            </span>
            <Tooltip label="instrument kind for the new row">
              <select
                value={newRowKind}
                onChange={(e) => setNewRowKind(e.target.value as TrackKind)}
                aria-label="new row kind"
                className="h-7 px-2 bg-bg-panel-2 border border-grid rounded text-[10px] uppercase tracking-widest font-mono text-ink-dim cursor-pointer focus-visible:outline-none focus-visible:border-neon-violet"
              >
                {TRACK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Tooltip>
            <Tooltip label="append a new row of the selected kind — duplicates allowed">
              <button
                type="button"
                onClick={() => {
                  syncPatternIntoMatrix();
                  addTrack(selectedCellId, newRowKind);
                  loadCellIntoPattern(selectedCellId);
                }}
                className="h-7 px-3 rounded border border-neon-violet/70 text-neon-violet text-[10px] uppercase tracking-widest font-mono hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none"
              >
                + add
              </button>
            </Tooltip>
          </div>
        </section>

        {/* Collapsible mixer — toggle button sits in the section header */}
        <section className="border border-grid rounded bg-bg-panel/50">
          <button
            type="button"
            onClick={() => setMixerOpen((o) => !o)}
            aria-expanded={mixerOpen}
            aria-controls="effects-rack-body"
            className={clsx(
              "w-full flex items-center justify-between px-4 py-3 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet focus-visible:ring-inset rounded",
              "hover:bg-neon-violet/5 transition-colors duration-150 ease-in motion-reduce:transition-none",
            )}
          >
            <h2 className="text-ink-muted text-xs uppercase tracking-widest">
              effects (master bus)
            </h2>
            <span
              aria-hidden
              className={clsx(
                "text-ink-muted text-xs font-mono transition-transform duration-200 ease-in motion-reduce:transition-none",
                mixerOpen ? "rotate-0" : "-rotate-90",
              )}
            >
              ▾
            </span>
          </button>
          {/* grid-rows trick: animates to exact height without a fixed max-height cap */}
          <div
            id="effects-rack-body"
            className={clsx(
              "grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none",
              mixerOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-4">
                <EffectsRack />
              </div>
            </div>
          </div>
        </section>
        <RecorderPanel />
      </div>
      <SessionInviteDialog
        open={sessionDialogOpen}
        onClose={() => setSessionDialogOpen(false)}
      />
      <SessionJoinPrompt />
    </div>
  );
}
