import { useState } from "react";
import clsx from "clsx";
import type { Project } from "@beats/shared";
import { api, ApiCallError } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteDialog({ open, onClose }: Props) {
  const project = useBeatsStore((s) => s.project.current);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open || !project) return null;

  const submit = async () => {
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
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
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="w-full h-10 px-3 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-sm focus-visible:outline-none"
          aria-label="email"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !email}>
            {busy ? "sending…" : "send invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
