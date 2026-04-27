import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import clsx from "clsx";
import {
  CUSTOM_SAMPLE_MAX_DURATION_MS,
  CUSTOM_SAMPLE_MAX_SOURCE_BYTES,
  CUSTOM_SAMPLE_MAX_SOURCE_DURATION_MS,
  CUSTOM_SAMPLE_MIN_DURATION_MS,
  type SampleRef,
} from "@beats/shared";
import { api, ApiCallError } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";
import { encodeWav } from "./lib/wav-encoder";
import { sliceAudioBuffer } from "./lib/audio-slice";
import { WaveformTrimmer } from "./WaveformTrimmer";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the finalized sample so the row can immediately auto-pick it. */
  onUploaded?: (sample: SampleRef) => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const ACCEPT = "audio/wav,audio/mpeg,audio/mp3,.wav,.mp3";

type Stage =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "ready"; buffer: AudioBuffer; fileName: string }
  | { kind: "uploading"; phase: "signing" | "putting" | "finalizing" }
  | { kind: "error"; message: string };

export function SampleUploadDialog({ open, onClose, onUploaded }: Props) {
  const addCustomSample = useBeatsStore((s) => s.addCustomSample);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [name, setName] = useState("");
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Restore focus + clear state on close so reopening is clean.
  useEffect(() => {
    if (!open) {
      setStage({ kind: "idle" });
      setName("");
      setStartMs(0);
      setEndMs(0);
      return;
    }
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  // ESC + focus trap (mirrors InviteDialog).
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        onClose();
        return;
      }
      if (evt.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (evt.shiftKey && active === first) {
        evt.preventDefault();
        last.focus();
      } else if (!evt.shiftKey && active === last) {
        evt.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function onPickFile(evt: React.ChangeEvent<HTMLInputElement>) {
    const file = evt.target.files?.[0];
    if (!file) return;
    if (file.size > CUSTOM_SAMPLE_MAX_SOURCE_BYTES) {
      setStage({
        kind: "error",
        message: `file too large — max ${Math.round(CUSTOM_SAMPLE_MAX_SOURCE_BYTES / (1024 * 1024))} MB`,
      });
      return;
    }
    setStage({ kind: "decoding" });
    try {
      const arrayBuf = await file.arrayBuffer();
      // Reuse the studio's shared AudioContext so decode + preview
      // playback share clocks; cheaper than spinning up a fresh one
      // every dialog mount.
      const ctx = Tone.getContext().rawContext as unknown as AudioContext;
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      if (decoded.duration * 1000 > CUSTOM_SAMPLE_MAX_SOURCE_DURATION_MS) {
        setStage({
          kind: "error",
          message: `audio too long — pre-trim cap is ${CUSTOM_SAMPLE_MAX_SOURCE_DURATION_MS / 1000}s`,
        });
        return;
      }
      const initialEnd = Math.min(
        decoded.duration * 1000,
        CUSTOM_SAMPLE_MAX_DURATION_MS,
      );
      setStartMs(0);
      setEndMs(initialEnd);
      setName(deriveName(file.name));
      setStage({ kind: "ready", buffer: decoded, fileName: file.name });
    } catch (err) {
      setStage({
        kind: "error",
        message:
          err instanceof Error
            ? `couldn't decode: ${err.message}`
            : "couldn't decode this audio",
      });
    }
  }

  async function onSave() {
    if (stage.kind !== "ready") return;
    const span = endMs - startMs;
    if (span < CUSTOM_SAMPLE_MIN_DURATION_MS) {
      pushToast(
        "warn",
        `selection too short — at least ${CUSTOM_SAMPLE_MIN_DURATION_MS}ms`,
      );
      return;
    }
    if (span > CUSTOM_SAMPLE_MAX_DURATION_MS) {
      pushToast(
        "warn",
        `selection too long — cap is ${CUSTOM_SAMPLE_MAX_DURATION_MS / 1000}s`,
      );
      return;
    }
    const trimmedName = name.trim().slice(0, 120) || "untitled sample";

    setStage({ kind: "uploading", phase: "signing" });
    try {
      const sliced = sliceAudioBuffer(stage.buffer, startMs, endMs);
      const blob = encodeWav(sliced);
      const durationMs = Math.round(span);

      // Stamp the sample with the active project so it joins that
      // project's rig instead of polluting every project the user
      // opens. Three sources, in priority order:
      //  1. project.current.id — the user is the host or collaborator
      //  2. collab.session.meta.projectId — the user is an invitee
      //     in someone else's session and wants to add to the host's
      //     rig (server verifies session participation)
      //  3. neither — anon / solo work, sample uploads user-scoped
      const state = useBeatsStore.getState();
      const projectId =
        state.project.current?.id ??
        state.collab.session.meta?.projectId ??
        null;
      const sessionId = state.collab.session.id ?? null;
      const signed = await api.post<{
        sampleId: string;
        uploadUrl: string;
        contentType: string;
      }>("/samples/upload-url", {
        name: trimmedName,
        durationMs,
        sourceFileName: stage.fileName,
        ...(projectId ? { projectId } : {}),
        // Only include sessionId when the upload is happening in the
        // context of a live session — server uses it to authorize
        // invitees who aren't project collaborators.
        ...(sessionId && projectId ? { sessionId } : {}),
      });

      setStage({ kind: "uploading", phase: "putting" });
      const putRes = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": signed.contentType },
        body: blob,
      });
      if (!putRes.ok) {
        throw new Error(`upload failed (${putRes.status})`);
      }

      setStage({ kind: "uploading", phase: "finalizing" });
      const finalized = await api.post<SampleRef & { status?: string }>(
        `/samples/${signed.sampleId}/finalize`,
        {},
      );
      addCustomSample(finalized);
      onUploaded?.(finalized);
      pushToast("success", `uploaded ${trimmedName}`);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiCallError
          ? err.apiError.message
          : err instanceof Error
            ? err.message
            : "upload failed";
      setStage({ kind: "error", message });
    }
  }

  const audioContext = Tone.getContext().rawContext as unknown as AudioContext;
  const busyMessage = stage.kind === "uploading" ? phaseLabel(stage.phase) : "";

  return (
    <div
      className="fixed inset-0 z-[80] bg-bg-void/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-upload-title"
        className={clsx(
          "bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-2xl space-y-4",
          "shadow-[var(--glow-violet)]",
        )}
      >
        <header className="flex items-center justify-between">
          <h3
            id="sample-upload-title"
            className="text-neon-violet text-sm uppercase tracking-[0.3em]"
          >
            upload + trim sample
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="text-ink-muted hover:text-ink text-xs font-mono uppercase tracking-widest"
          >
            esc
          </button>
        </header>

        {stage.kind === "idle" && (
          <div className="space-y-3">
            <p className="text-ink-dim text-xs">
              Pick a WAV or MP3 file. You can preview, trim it down to
              {` ${CUSTOM_SAMPLE_MAX_DURATION_MS / 1000}`}s, then save it as a
              custom sample on this account.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              onChange={onPickFile}
              aria-label="audio file"
              className="block w-full text-xs text-ink-dim font-mono file:mr-3 file:rounded file:border file:border-grid file:bg-bg-panel-2 file:text-ink-muted file:px-3 file:py-2 file:font-mono file:text-xs file:uppercase file:tracking-widest hover:file:border-neon-violet hover:file:text-neon-violet file:cursor-pointer"
            />
          </div>
        )}

        {stage.kind === "decoding" && (
          <p className="text-ink-muted text-xs uppercase tracking-widest font-mono">
            decoding…
          </p>
        )}

        {stage.kind === "ready" && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
                name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="w-full h-9 px-2 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-sm focus-visible:border-neon-violet focus-visible:outline-none"
                aria-label="sample name"
              />
            </label>
            <WaveformTrimmer
              buffer={stage.buffer}
              startMs={startMs}
              endMs={endMs}
              onChange={({ startMs: s, endMs: e }) => {
                setStartMs(s);
                setEndMs(e);
              }}
              audioContext={audioContext}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>
                cancel
              </Button>
              <Button type="button" onClick={onSave}>
                save sample
              </Button>
            </div>
          </div>
        )}

        {stage.kind === "uploading" && (
          <div className="space-y-2">
            <p className="text-ink-muted text-xs uppercase tracking-widest font-mono">
              {busyMessage}
            </p>
            <div className="h-1 bg-bg-panel-2 rounded overflow-hidden">
              <div className="h-full bg-neon-violet animate-pulse w-1/2" />
            </div>
          </div>
        )}

        {stage.kind === "error" && (
          <div className="space-y-3">
            <p
              role="alert"
              className="text-neon-red text-xs font-mono uppercase tracking-widest"
            >
              {stage.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStage({ kind: "idle" })}
              >
                try again
              </Button>
              <Button type="button" onClick={onClose}>
                close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function deriveName(fileName: string): string {
  return fileName
    .replace(/\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 120);
}

function phaseLabel(phase: "signing" | "putting" | "finalizing"): string {
  if (phase === "signing") return "preparing upload…";
  if (phase === "putting") return "uploading…";
  return "finalizing…";
}
