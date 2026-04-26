import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * "Start live session" dialog — owner-only entry point. On open, if no
 * session is active for this project, it offers a single CTA to spin
 * one up. Once active, it shows the shareable URL + the participant
 * count + an end-session button.
 *
 * Separate from InviteDialog (which writes a permanent collaborator on
 * the project doc) because live sessions are ephemeral and have a
 * different mental model — link-only access, dies when the owner
 * leaves.
 */
export function SessionInviteDialog({ open, onClose }: Props) {
  const project = useBeatsStore((s) => s.project.current);
  const startSession = useBeatsStore((s) => s.startSession);
  const endSession = useBeatsStore((s) => s.endSession);
  const session = useBeatsStore((s) => s.collab.session);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

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

  if (!open || !project) return null;

  const isOwner = project.ownerId === myUid;
  const sessionActive = session.id !== null;
  // Build the share URL from the current origin so we don't leak prod
  // into dev or vice versa. Trailing slash optional — fetch handlers
  // strip them.
  const shareUrl =
    typeof window !== "undefined" && session.id
      ? `${window.location.origin}/studio/${project.id}?session=${session.id}`
      : "";
  const participantCount = Object.keys(session.participants).length;

  const onStart = async () => {
    setBusy(true);
    try {
      const id = await startSession(project.id);
      if (!id) {
        pushToast("error", "couldn't start a session — try again");
      }
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    setBusy(true);
    try {
      await endSession();
      pushToast("info", "session ended");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      pushToast("success", "invite link copied");
    } catch {
      pushToast("warn", "couldn't copy — select and copy manually");
    }
  };

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
        aria-labelledby="session-title"
        className={clsx(
          "bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-md space-y-4",
          "shadow-[var(--glow-violet)]",
        )}
      >
        <header className="flex items-center justify-between">
          <h3
            id="session-title"
            className="text-neon-violet text-sm uppercase tracking-[0.3em]"
          >
            live session
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

        {!sessionActive && (
          <div className="space-y-3">
            <p className="text-ink-dim text-xs">
              Start a live session and share the link. Anyone signed in who
              follows it joins the same project — edits, cursors, and changes
              happen in real time.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                cancel
              </Button>
              <Button
                type="button"
                onClick={onStart}
                disabled={busy || !isOwner}
              >
                {busy ? "starting…" : isOwner ? "start session" : "owner only"}
              </Button>
            </div>
          </div>
        )}

        {sessionActive && (
          <div className="space-y-3">
            <p className="text-ink-dim text-xs">
              Share this link. {participantCount} in the room.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                aria-label="invite link"
                className="flex-1 h-9 px-2 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-xs select-all"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" onClick={onCopy}>
                copy
              </Button>
            </div>
            <div className="flex justify-between gap-2 pt-1">
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onEnd}
                  disabled={busy}
                >
                  {busy ? "ending…" : "end session"}
                </Button>
              )}
              <Button type="button" onClick={onClose}>
                done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
