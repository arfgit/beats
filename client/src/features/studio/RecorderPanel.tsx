import { useEffect, useState } from "react";
import clsx from "clsx";
import { MAX_RECORDING_MS } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useAudioEvent } from "@/audio/useAudioEvent";
import { Tooltip } from "@/components/ui/Tooltip";

const WARN_MS = 90_000; // warn at 90s, hard cap at 120s

export function RecorderPanel() {
  const isRecording = useBeatsStore((s) => s.transport.isRecording);
  const startRecording = useBeatsStore((s) => s.startRecording);
  const stopRecording = useBeatsStore((s) => s.stopRecording);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const recState = useAudioEvent("rec", { active: false, elapsedMs: 0 });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (!recState.active) return;
    if (!warned && recState.elapsedMs >= WARN_MS) {
      setWarned(true);
      pushToast("warn", "recording will stop automatically at 2:00");
    }
  }, [recState.active, recState.elapsedMs, warned, pushToast]);

  useEffect(() => {
    if (!recState.active) setWarned(false);
  }, [recState.active]);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const handleClick = async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob) {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        pushToast("success", "recording ready — download below");
      }
      return;
    }
    try {
      await startRecording();
    } catch (err) {
      const message = err instanceof Error ? err.message : "record failed";
      pushToast("error", message);
    }
  };

  const elapsed = formatElapsed(recState.active ? recState.elapsedMs : 0);
  const progressPct = Math.min(
    100,
    (recState.elapsedMs / MAX_RECORDING_MS) * 100,
  );

  return (
    <section className="border border-grid rounded p-3 bg-bg-panel/60 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-ink-muted text-xs uppercase tracking-widest">
          record
        </h2>
        <span className="text-[10px] font-mono text-ink-muted">max 2:00</span>
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
                ? "bg-neon-red text-bg-void border-neon-red animate-pulse"
                : "border-neon-red text-neon-red hover:bg-neon-red hover:text-bg-void",
            )}
          >
            {isRecording ? "■ stop" : "● rec"}
          </button>
        </Tooltip>
        <span
          className={clsx(
            "font-mono text-lg tabular-nums",
            recState.elapsedMs >= WARN_MS ? "text-neon-sun" : "text-neon-cyan",
          )}
        >
          {elapsed}
        </span>
        <div className="flex-1 h-1 bg-grid rounded overflow-hidden">
          <div
            className={clsx(
              "h-full transition-[width] duration-250 ease-linear",
              "motion-reduce:transition-none",
              recState.elapsedMs >= WARN_MS ? "bg-neon-sun" : "bg-neon-red",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`beats-${new Date().toISOString().slice(0, 10)}.wav`}
          className="inline-block text-[10px] uppercase tracking-widest text-neon-cyan border-b border-neon-cyan pb-0.5 hover:text-neon-violet hover:border-neon-violet transition-colors duration-200"
        >
          download wav
        </a>
      )}
    </section>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
