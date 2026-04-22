import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { computeMatrixRecordingCapMs } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useAudioEvent } from "@/audio/useAudioEvent";
import { Tooltip } from "@/components/ui/Tooltip";
import type { RecordingFormat } from "@/audio/recorder";

// Warn at 75% of the cap — enough headroom that the user can gracefully
// stop, but not so early that they think they've hit the cap when they
// haven't.
const WARN_FRACTION = 0.75;

export function RecorderPanel() {
  const isRecording = useBeatsStore((s) => s.transport.isRecording);
  const isRecordingPlayback = useBeatsStore(
    (s) => s.transport.isRecordingPlayback,
  );
  const matrix = useBeatsStore((s) => s.matrix);
  const startRecording = useBeatsStore((s) => s.startRecording);
  const stopRecording = useBeatsStore((s) => s.stopRecording);
  const setRecordingPlayback = useBeatsStore((s) => s.setRecordingPlayback);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const recState = useAudioEvent("rec", { active: false, elapsedMs: 0 });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [lastFormat, setLastFormat] = useState<RecordingFormat>("wav");
  const [warned, setWarned] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Cap is derived from the matrix's enabled-cell count × beats per bar
  // at the current bpm. Updates live as the user toggles cells or changes
  // bpm so the UI / warn threshold always reflect what the hard cap
  // actually is right now.
  const capMs = computeMatrixRecordingCapMs(matrix);
  const warnMs = Math.round(capMs * WARN_FRACTION);

  useEffect(() => {
    if (!recState.active) return;
    if (!warned && recState.elapsedMs >= warnMs) {
      setWarned(true);
      pushToast("warn", `recording will auto-stop at ${formatElapsed(capMs)}`);
    }
  }, [recState.active, recState.elapsedMs, warned, warnMs, capMs, pushToast]);

  useEffect(() => {
    if (!recState.active) setWarned(false);
  }, [recState.active]);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  // Store is the source of truth for mutual exclusion. When live transport
  // starts via play(), the slice sets isRecordingPlayback to false — we
  // react by calling pause() on the element. The audio element's own events
  // (onPlay/onPause) set isRecordingPlayback, which from the other
  // direction stops live transport via the slice. One rule, one listener.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isRecordingPlayback && !audio.paused) {
      audio.pause();
    }
  }, [isRecordingPlayback]);

  const handleClick = async () => {
    if (isRecording) {
      const result = await stopRecording();
      if (result) {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        const url = URL.createObjectURL(result.blob);
        setDownloadUrl(url);
        setLastFormat(result.format);
        pushToast("success", "recording ready — download below");
      }
      // If result is null, transportSlice.stopRecording already pushed an
      // error toast with the detail — nothing to do here.
      return;
    }
    try {
      await startRecording();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      pushToast("error", `couldn't start recording: ${detail}`);
    }
  };

  const elapsed = formatElapsed(recState.active ? recState.elapsedMs : 0);
  const progressPct = Math.min(100, (recState.elapsedMs / capMs) * 100);

  return (
    <section className="border border-grid rounded p-3 bg-bg-panel/60 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ink-muted text-xs uppercase tracking-widest">
          record
        </h2>
        <span className="text-[10px] font-mono text-ink-muted">
          max {formatElapsed(capMs)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Tooltip
          label={isRecording ? "stop recording" : "record master output"}
        >
          <button
            type="button"
            onClick={() => void handleClick()}
            aria-pressed={isRecording}
            className={clsx(
              "h-10 px-4 rounded border uppercase text-xs tracking-widest font-mono",
              "transition-colors duration-200 ease-in motion-reduce:transition-none",
              isRecording
                ? "bg-neon-red/20 text-neon-red border-neon-red animate-pulse"
                : "border-neon-red/70 text-neon-red hover:bg-neon-red/10",
            )}
          >
            {isRecording ? "■ stop" : "● rec"}
          </button>
        </Tooltip>
        <span
          className={clsx(
            "font-mono text-lg tabular-nums",
            recState.elapsedMs >= warnMs ? "text-neon-sun" : "text-neon-cyan",
          )}
        >
          {elapsed}
        </span>
        <div className="flex-1 h-1 bg-grid rounded overflow-hidden">
          <div
            className={clsx(
              "h-full transition-[width] duration-250 ease-linear",
              "motion-reduce:transition-none",
              recState.elapsedMs >= warnMs ? "bg-neon-sun" : "bg-neon-red",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {downloadUrl && (
        <div className="pt-2 border-t border-grid/40 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              last take
            </span>
            <a
              href={downloadUrl}
              download={`beats-${new Date().toISOString().slice(0, 10)}.${lastFormat}`}
              className="text-[10px] uppercase tracking-widest text-neon-cyan border-b border-neon-cyan/60 pb-0.5 hover:text-ink hover:border-ink transition-colors duration-200 motion-reduce:transition-none"
            >
              download {lastFormat} ↓
            </a>
          </div>
          <TakePlayer
            audioRef={audioRef}
            src={downloadUrl}
            onPlay={() => setRecordingPlayback(true)}
            onPause={() => setRecordingPlayback(false)}
            onEnded={() => setRecordingPlayback(false)}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Styled take player — mirrors the record controls (mono-cyan transport,
 * violet-tinted progress, tabular-nums time) so the "last take" section
 * reads as part of the same synth-wave surface rather than a browser
 * default control surface. The underlying `<audio>` still does the heavy
 * lifting (decoding, seeking) — we just drive it from custom UI.
 */
function TakePlayer({
  audioRef,
  src,
  onPlay,
  onPause,
  onEnded,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  src: string;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Reset local state when the source changes (new take).
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  // Time updates come from the audio element. When the user is actively
  // scrubbing, freeze the display at their target so the visual doesn't
  // jitter back to the element's previous playhead mid-drag.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      if (!isScrubbing) setCurrentTime(el.currentTime);
    };
    const onLoaded = () => {
      // MediaRecorder webm blobs sometimes report Infinity until the
      // first real seek. Clamp obviously-broken durations.
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      setDuration(d);
    };
    const onPlayEl = () => {
      setPlaying(true);
      onPlay();
    };
    const onPauseEl = () => {
      setPlaying(false);
      onPause();
    };
    const onEndedEl = () => {
      setPlaying(false);
      onEnded();
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("durationchange", onLoaded);
    el.addEventListener("play", onPlayEl);
    el.addEventListener("pause", onPauseEl);
    el.addEventListener("ended", onEndedEl);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("durationchange", onLoaded);
      el.removeEventListener("play", onPlayEl);
      el.removeEventListener("pause", onPauseEl);
      el.removeEventListener("ended", onEndedEl);
    };
  }, [audioRef, isScrubbing, onPlay, onPause, onEnded]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const onSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
  };
  const onSeekCommit = (e: React.FormEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const val = Number((e.target as HTMLInputElement).value);
    el.currentTime = val;
    setIsScrubbing(false);
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      {/* Hidden <audio> — still the source of truth, just not visible. */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <Tooltip label={playing ? "pause" : "play last take"}>
        <button
          type="button"
          onClick={togglePlay}
          aria-pressed={playing}
          aria-label={playing ? "pause take playback" : "play take"}
          className={clsx(
            "h-10 w-10 rounded border flex items-center justify-center",
            "font-mono text-sm shrink-0",
            "transition-colors duration-200 ease-in motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet",
            playing
              ? "bg-neon-cyan/20 text-neon-cyan border-neon-cyan"
              : "border-neon-cyan/70 text-neon-cyan hover:bg-neon-cyan/10",
          )}
        >
          {playing ? "■" : "▶"}
        </button>
      </Tooltip>
      <span className="font-mono text-xs tabular-nums text-neon-cyan w-10 text-right">
        {formatElapsed(currentTime * 1000)}
      </span>
      <div className="relative flex-1 h-2">
        {/* Fill track (display-only) */}
        <div
          aria-hidden
          className="absolute inset-0 bg-grid rounded overflow-hidden"
        >
          <div
            className="h-full bg-neon-violet/70 transition-[width] duration-100 ease-linear motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Invisible range for scrub interaction — sits on top with full opacity 0 */}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          disabled={duration === 0}
          onMouseDown={() => setIsScrubbing(true)}
          onTouchStart={() => setIsScrubbing(true)}
          onChange={onSeekChange}
          onMouseUp={onSeekCommit}
          onTouchEnd={onSeekCommit}
          onKeyUp={onSeekCommit}
          aria-label="take playback position"
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-ink-muted w-10">
        {formatElapsed(duration * 1000)}
      </span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
