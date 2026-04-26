import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  CUSTOM_SAMPLE_MAX_DURATION_MS,
  CUSTOM_SAMPLE_MIN_DURATION_MS,
} from "@beats/shared";
import { computePeaks, type WaveformPeaks } from "./lib/waveform-peaks";
import { sliceAudioBuffer } from "./lib/audio-slice";

interface Props {
  buffer: AudioBuffer;
  startMs: number;
  endMs: number;
  onChange: (next: { startMs: number; endMs: number }) => void;
  /** Shared playback context so previews stop cleanly on unmount. */
  audioContext: AudioContext;
}

/**
 * Canvas-rendered waveform with two draggable trim handles. The handles
 * are positioned in pixel space against the canvas client width; ms
 * conversions hop through the buffer's duration so they survive the
 * canvas being resized at any time. Keyboard left/right nudges by
 * 10 ms (Shift = 100 ms).
 */
export function WaveformTrimmer({
  buffer,
  startMs,
  endMs,
  onChange,
  audioContext,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [drag, setDrag] = useState<"in" | "out" | "scrub" | null>(null);
  const [scrubMs, setScrubMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const durationMs = buffer.duration * 1000;
  const cap = Math.min(CUSTOM_SAMPLE_MAX_DURATION_MS, durationMs);

  // Recompute peaks whenever the canvas resizes or the buffer changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      if (w > 0) setPeaks(computePeaks(buffer, w));
    });
    observer.observe(canvas);
    setPeaks(computePeaks(buffer, canvas.clientWidth || 600));
    return () => observer.disconnect();
  }, [buffer]);

  // Paint loop — runs on peak / handle / playback changes only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const startPx = (startMs / durationMs) * w;
    const endPx = (endMs / durationMs) * w;

    // Out-of-selection waveform — muted.
    ctx.fillStyle = "rgba(184,163,232,0.3)";
    drawWaveform(ctx, peaks, mid, h, 0, startPx);
    drawWaveform(ctx, peaks, mid, h, endPx, w);

    // In-selection waveform — full intensity.
    ctx.fillStyle = "rgba(132,255,210,0.95)";
    drawWaveform(ctx, peaks, mid, h, startPx, endPx);

    // Selection backdrop tint.
    ctx.fillStyle = "rgba(132,255,210,0.08)";
    ctx.fillRect(startPx, 0, endPx - startPx, h);

    // Scrub line.
    if (isPlaying || drag === "scrub") {
      const sx = (scrubMs / durationMs) * w;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(sx - 0.5, 0, 1, h);
    }

    // Handle bars.
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(startPx - 1, 0, 2, h);
    ctx.fillRect(endPx - 1, 0, 2, h);
  }, [peaks, startMs, endMs, durationMs, isPlaying, scrubMs, drag]);

  // Animate the scrub line during preview playback.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const elapsed =
        (audioContext.currentTime - playStartedAtRef.current) * 1000;
      const next = startMs + elapsed;
      if (next >= endMs) {
        stopPlayback();
        return;
      }
      setScrubMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, startMs, endMs, audioContext]);

  // Stop preview on unmount so the audio context isn't leaking nodes.
  useEffect(() => {
    return () => stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPlayback() {
    const src = playSourceRef.current;
    if (src) {
      try {
        src.stop();
      } catch {
        // Already stopped — ignore.
      }
      src.disconnect();
      playSourceRef.current = null;
    }
    setIsPlaying(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function startPlayback() {
    stopPlayback();
    const sliced = sliceAudioBuffer(buffer, startMs, endMs);
    const src = audioContext.createBufferSource();
    src.buffer = sliced;
    src.connect(audioContext.destination);
    src.onended = () => stopPlayback();
    src.start();
    playSourceRef.current = src;
    playStartedAtRef.current = audioContext.currentTime;
    setIsPlaying(true);
    setScrubMs(startMs);
  }

  function pixelToMs(clientX: number): number {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const ms = ratio * durationMs;
    return Math.max(0, Math.min(durationMs, ms));
  }

  function clampInOut(nextStart: number, nextEnd: number) {
    const minSpan = CUSTOM_SAMPLE_MIN_DURATION_MS;
    let s = Math.max(0, Math.min(nextStart, durationMs - minSpan));
    let e = Math.max(s + minSpan, Math.min(nextEnd, durationMs));
    if (e - s > cap) {
      // Cap the selection span at 15 s — the trimmer's hard limit.
      // Keep whichever end the user just touched anchored.
      if (drag === "out") s = e - cap;
      else e = s + cap;
    }
    return { startMs: s, endMs: e };
  }

  function onPointerDown(evt: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ms = pixelToMs(evt.clientX);
    const startPx = (startMs / durationMs) * canvas.clientWidth;
    const endPx = (endMs / durationMs) * canvas.clientWidth;
    const clickPx =
      ((evt.clientX - canvas.getBoundingClientRect().left) /
        canvas.getBoundingClientRect().width) *
      canvas.clientWidth;
    // Pick whichever handle is within 8px; otherwise scrub.
    const HANDLE_HIT = 8;
    let mode: "in" | "out" | "scrub" = "scrub";
    if (Math.abs(clickPx - startPx) <= HANDLE_HIT) mode = "in";
    else if (Math.abs(clickPx - endPx) <= HANDLE_HIT) mode = "out";
    setDrag(mode);
    canvas.setPointerCapture(evt.pointerId);
    if (mode === "in") onChange(clampInOut(ms, endMs));
    else if (mode === "out") onChange(clampInOut(startMs, ms));
    else setScrubMs(ms);
  }

  function onPointerMove(evt: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const ms = pixelToMs(evt.clientX);
    if (drag === "in") onChange(clampInOut(ms, endMs));
    else if (drag === "out") onChange(clampInOut(startMs, ms));
    else setScrubMs(ms);
  }

  function onPointerUp(evt: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(evt.pointerId)) {
      canvas.releasePointerCapture(evt.pointerId);
    }
    setDrag(null);
  }

  function onKey(evt: React.KeyboardEvent<HTMLDivElement>) {
    if (evt.key === " ") {
      evt.preventDefault();
      isPlaying ? stopPlayback() : startPlayback();
      return;
    }
    const step = evt.shiftKey ? 100 : 10;
    if (evt.key === "ArrowLeft") {
      evt.preventDefault();
      if (evt.altKey) onChange(clampInOut(startMs, endMs - step));
      else onChange(clampInOut(startMs - step, endMs));
    }
    if (evt.key === "ArrowRight") {
      evt.preventDefault();
      if (evt.altKey) onChange(clampInOut(startMs, endMs + step));
      else onChange(clampInOut(startMs + step, endMs));
    }
  }

  const selectionMs = endMs - startMs;
  const overCap = selectionMs > cap;

  return (
    <div
      className="space-y-2"
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label="audio trimmer"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={clsx(
          "w-full h-32 bg-bg-panel-2 rounded border cursor-crosshair touch-none select-none",
          overCap ? "border-neon-red" : "border-grid",
        )}
        style={{ display: "block" }}
        aria-label="waveform"
      />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-mono text-ink-muted">
        <span>
          in <span className="text-ink">{Math.round(startMs)}ms</span>
        </span>
        <span>
          length{" "}
          <span className={overCap ? "text-neon-red" : "text-ink"}>
            {Math.round(selectionMs)}ms
          </span>{" "}
          / {Math.round(cap)}ms cap
        </span>
        <span>
          out <span className="text-ink">{Math.round(endMs)}ms</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (isPlaying ? stopPlayback() : startPlayback())}
          aria-label={isPlaying ? "stop preview" : "play selection"}
          className="h-8 px-3 rounded border border-grid text-xs font-mono uppercase tracking-widest text-ink-muted hover:border-neon-violet hover:text-neon-violet transition-colors duration-150 motion-reduce:transition-none"
        >
          {isPlaying ? "stop" : "preview"}
        </button>
        <span className="text-[10px] text-ink-muted font-mono">
          drag handles · ←/→ nudge · alt+←/→ end · space play
        </span>
      </div>
    </div>
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: WaveformPeaks,
  mid: number,
  h: number,
  fromPx: number,
  toPx: number,
) {
  if (toPx <= fromPx) return;
  const widthRatio = peaks.width / Math.max(1, ctx.canvas.clientWidth);
  const startBucket = Math.max(0, Math.floor(fromPx * widthRatio));
  const endBucket = Math.min(peaks.width, Math.ceil(toPx * widthRatio));
  for (let bucket = startBucket; bucket < endBucket; bucket++) {
    const x = bucket / widthRatio;
    const min = peaks.mins[bucket]!;
    const max = peaks.maxs[bucket]!;
    const top = mid - max * (h / 2);
    const bottom = mid - min * (h / 2);
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}
