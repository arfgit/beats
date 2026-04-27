import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { DEFAULT_SESSION_PERMISSIONS } from "@beats/shared";
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
  // Session-aware: when the user is an INVITEE in someone else's
  // session, hide the save UI and show a read-only banner instead.
  // Without this, invitees (who deliberately have project.current=null)
  // would see the create-project flow with "untitled beat" prefilled,
  // misleading them into thinking they can save the host's project as
  // their own.
  const sessionId = useBeatsStore((s) => s.collab.session.id);
  const sessionMeta = useBeatsStore((s) => s.collab.session.meta);
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  const setSessionPermissions = useBeatsStore((s) => s.setSessionPermissions);
  const forkSessionProject = useBeatsStore((s) => s.forkSessionProject);
  const leaveSession = useBeatsStore((s) => s.leaveSession);
  const endSession = useBeatsStore((s) => s.endSession);
  const navigate = useNavigate();
  const [forking, setForking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Only treat the bar as "live" when this tab is actually viewing
  // the session's project. Without this gate the live banner stays
  // pinned even when the user clicks a different project — they're
  // not really live ON that project, they just happen to have a
  // session attached to a different one.
  const sessionMatchesLoadedProject =
    !!sessionMeta && !!project && sessionMeta.projectId === project.id;
  const sessionAffectsThisView =
    !!sessionId && (sessionMatchesLoadedProject || !project);
  const isInviteeInSession =
    sessionAffectsThisView && !!sessionMeta && sessionMeta.ownerUid !== myUid;
  const isHostInSession =
    sessionAffectsThisView && !!sessionMeta && sessionMeta.ownerUid === myUid;
  const inviteesCanEditGlobal =
    sessionMeta?.permissions?.inviteesCanEditGlobal ??
    DEFAULT_SESSION_PERMISSIONS.inviteesCanEditGlobal;
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState("untitled beat");
  const [inviteOpen, setInviteOpen] = useState(false);
  // Local title draft decouples the controlled input from the server-backed
  // project.title; we only PATCH on blur / Enter to avoid revision churn
  // on every keystroke.
  const [titleDraft, setTitleDraft] = useState(project?.title ?? "");
  useEffect(() => {
    setTitleDraft(project?.title ?? "");
  }, [project?.id, project?.title]);

  const status = statusLabels[saveStatus] ?? statusLabels.idle!;

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!project || !next || next === project.title) return;
    void setTitle(next);
  };

  if (!authed) {
    return (
      <div className="border border-grid rounded p-3 bg-bg-panel/60 text-xs text-ink-muted">
        sign in to save projects.
      </div>
    );
  }

  if (isInviteeInSession && sessionMeta) {
    return (
      <div className="border border-neon-violet/60 rounded p-3 bg-neon-violet/5 flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-neon-violet font-mono">
          live · guest
        </span>
        <span className="flex-1 min-w-[200px] text-sm text-ink font-mono truncate">
          {sessionMeta.projectTitle}
        </span>
        <span className="text-xs text-ink-muted">
          hosted by{" "}
          <span className="text-ink">{sessionMeta.ownerDisplayName}</span>
        </span>
        <Tooltip label="copy this beat into your own account — leaves the session">
          <Button
            variant="ghost"
            disabled={forking || leaving}
            onClick={async () => {
              setForking(true);
              const fork = await forkSessionProject();
              setForking(false);
              if (fork) navigate(`/studio/${fork.id}`);
            }}
          >
            {forking ? "forking…" : "fork to my account"}
          </Button>
        </Tooltip>
        <Tooltip label="leave this jam — host and other peers stay connected">
          <Button
            variant="ghost"
            disabled={leaving || forking}
            onClick={async () => {
              setLeaving(true);
              await leaveSession();
              setLeaving(false);
              navigate("/");
            }}
          >
            {leaving ? "leaving…" : "leave jam"}
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="border border-grid rounded p-3 bg-bg-panel/60 flex flex-wrap items-center gap-3">
      {project ? (
        <>
          <label className="relative flex-1 min-w-[160px] sm:min-w-[200px]">
            <span className="sr-only">project title</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full h-9 pl-2 pr-8 bg-bg-panel border border-grid rounded text-ink font-mono text-sm hover:border-ink-muted focus-visible:outline-none focus-visible:border-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none"
              aria-label="project title"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs"
              title="editable"
            >
              ✎
            </span>
          </label>
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
          {isHostInSession && (
            <Tooltip
              label={
                inviteesCanEditGlobal
                  ? "invitees can clear matrix and run other matrix-wide actions — click to lock"
                  : "invitees can edit cells but can't clear or seed the matrix — click to unlock"
              }
            >
              <button
                type="button"
                aria-pressed={!inviteesCanEditGlobal}
                aria-label={
                  inviteesCanEditGlobal
                    ? "lock global actions for invitees"
                    : "unlock global actions for invitees"
                }
                disabled={permissionsBusy}
                onClick={async () => {
                  setPermissionsBusy(true);
                  await setSessionPermissions({
                    inviteesCanEditGlobal: !inviteesCanEditGlobal,
                  });
                  setPermissionsBusy(false);
                }}
                className={clsx(
                  "h-9 px-3 rounded border text-[10px] uppercase tracking-widest font-mono",
                  "transition-colors duration-200 ease-in motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet",
                  "disabled:opacity-60 disabled:cursor-wait",
                  inviteesCanEditGlobal
                    ? "border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet"
                    : "border-neon-violet text-neon-violet bg-neon-violet/10",
                )}
              >
                {inviteesCanEditGlobal ? "🔓 open jam" : "🔒 host only"}
              </button>
            </Tooltip>
          )}
          {isHostInSession && (
            <Tooltip label="end the live session for everyone">
              <Button
                variant="ghost"
                disabled={leaving}
                onClick={async () => {
                  setLeaving(true);
                  await endSession();
                  setLeaving(false);
                }}
              >
                {leaving ? "ending…" : "end jam"}
              </Button>
            </Tooltip>
          )}
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
            className="h-9 px-2 bg-bg-panel border border-grid rounded text-ink font-mono text-sm focus-visible:outline-none flex-1 min-w-[160px] sm:min-w-[200px]"
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
