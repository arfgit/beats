import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Project } from "@beats/shared";
import { api, ApiCallError } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function InviteDialog({ open, onClose }: Props) {
  const project = useBeatsStore((s) => s.project.current);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Remember the previously-focused element and restore on close.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  // ESC to close + focus trap.
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

  const submit = async (evt?: React.FormEvent) => {
    evt?.preventDefault();
    setBusy(true);
    try {
      await api.post<Project>(`/projects/${project.id}/collaborators`, {
        email,
      });
      pushToast("success", `invited ${email}`);
      setEmail("");
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "invite failed";
      pushToast("error", message);
    } finally {
      setBusy(false);
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
        aria-labelledby="invite-title"
        className={clsx(
          "bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-sm space-y-4",
          "shadow-[var(--glow-violet)]",
        )}
      >
        <h3
          id="invite-title"
          className="text-neon-violet text-sm uppercase tracking-[0.3em]"
        >
          invite collaborator
        </h3>
        <p className="text-ink-dim text-xs">
          They will be able to edit the pattern and see your cursor in real
          time.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full h-10 px-3 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-sm"
            aria-label="email"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              cancel
            </Button>
            <Button type="submit" disabled={busy || !email}>
              {busy ? "sending…" : "send invite"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
