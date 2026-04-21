import { useState } from "react";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { InviteDialog } from "./InviteDialog";

const statusLabels: Record<string, { label: string; tone: string }> = {
  idle: { label: "unsaved draft", tone: "text-ink-muted" },
  dirty: { label: "editing…", tone: "text-ink-dim" },
  saving: { label: "saving…", tone: "text-neon-cyan" },
  saved: { label: "saved", tone: "text-neon-green" },
  offline: { label: "offline · queued", tone: "text-neon-sun" },
  conflict: { label: "conflict — reload", tone: "text-neon-red" },
  error: { label: "error", tone: "text-neon-red" },
};

export function SaveShareBar() {
  const project = useBeatsStore((s) => s.project.current);
  const saveStatus = useBeatsStore((s) => s.project.saveStatus);
  const isLockOwner = useBeatsStore((s) => s.project.isLockOwner);
  const authed = useBeatsStore((s) => s.auth.status === "authed");
  const createProject = useBeatsStore((s) => s.createProject);
  const forkProject = useBeatsStore((s) => s.forkProject);
  const setIsPublic = useBeatsStore((s) => s.setIsPublic);
  const setTitle = useBeatsStore((s) => s.setTitle);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [draftTitle, setDraftTitle] = useState("untitled beat");
  const [inviteOpen, setInviteOpen] = useState(false);

  const status = statusLabels[saveStatus] ?? statusLabels.idle!;

  if (!authed) {
    return (
      <div className="border border-grid rounded p-3 bg-bg-panel/60 text-xs text-ink-muted">
        sign in to save projects.
      </div>
    );
  }

  return (
    <div className="border border-grid rounded p-3 bg-bg-panel/60 flex flex-wrap items-center gap-3">
      {project ? (
        <>
          <input
            value={project.title}
            onChange={(e) => void setTitle(e.target.value)}
            className="h-9 px-2 bg-bg-panel border border-grid rounded text-ink font-mono text-sm focus-visible:outline-none flex-1 min-w-[200px]"
            aria-label="project title"
          />
          <Tooltip
            label={project.isPublic ? "make private" : "publish to gallery"}
          >
            <button
              type="button"
              onClick={() => void setIsPublic(!project.isPublic)}
              aria-pressed={project.isPublic}
              className={clsx(
                "h-9 px-3 rounded border text-[10px] uppercase tracking-widest font-mono",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                project.isPublic
                  ? "border-neon-green text-neon-green bg-neon-green/10"
                  : "border-grid text-ink-muted hover:border-neon-green hover:text-neon-green",
              )}
            >
              {project.isPublic ? "public" : "private"}
            </button>
          </Tooltip>
          <Tooltip label="duplicate into your account">
            <Button variant="ghost" onClick={() => void forkProject()}>
              fork
            </Button>
          </Tooltip>
          <Tooltip label="invite someone to co-edit">
            <Button variant="ghost" onClick={() => setInviteOpen(true)}>
              invite
            </Button>
          </Tooltip>
          <InviteDialog
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
          />
          <span
            className={clsx(
              "text-[10px] uppercase tracking-widest ml-auto",
              status.tone,
            )}
          >
            {status.label}
            {!isLockOwner && " · read-only (open in another tab)"}
          </span>
        </>
      ) : (
        <>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="title"
            className="h-9 px-2 bg-bg-panel border border-grid rounded text-ink font-mono text-sm focus-visible:outline-none flex-1 min-w-[200px]"
            aria-label="new project title"
          />
          <Button
            onClick={async () => {
              try {
                await createProject(draftTitle || "untitled beat", false);
                pushToast("success", "project saved");
              } catch {
                pushToast("error", "save failed");
              }
            }}
          >
            save
          </Button>
        </>
      )}
    </div>
  );
}
