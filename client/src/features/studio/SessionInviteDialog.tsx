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
  const createProject = useBeatsStore((s) => s.createProject);
  const session = useBeatsStore((s) => s.collab.session);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
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

  if (!open) return null;

  const isOwner = project ? project.ownerId === myUid : true;
  const sessionActive = session.id !== null;
  // Build the share URL from the current origin so we don't leak prod
  // into dev or vice versa. Trailing slash optional — fetch handlers
  // strip them.
  const shareUrl =
    typeof window !== "undefined" && session.id && project
      ? `${window.location.origin}/studio/${project.id}?session=${session.id}`
      : "";
  const participantCount = Object.keys(session.participants).length;

  const onStart = async () => {
    if (!project) return;
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

  // No saved project yet — the only path to a session is to first
  // create one. Save under the user-supplied (or default) title, then
  // pivot directly into startSession with the new id. Keeps the user
  // in one dialog instead of bouncing them out to the SaveShareBar.
  const onSaveAndStart = async () => {
    setBusy(true);
    try {
      const title = draftTitle.trim() || "untitled beat";
      const created = await createProject(title, false);
      if (!created) {
        pushToast("error", "couldn't save the project");
        return;
      }
      const id = await startSession(created.id);
      if (!id) {
        pushToast("error", "saved, but couldn't start the session");
      } else {
        pushToast("success", "project saved and session started");
      }
    } catch {
      pushToast("error", "save failed");
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

        {!sessionActive && !project && (
          <div className="space-y-3">
            <p className="text-ink-dim text-xs">
              Save your project first. We&apos;ll save it, then start the live
              session — anyone with the link can join from there.
            </p>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="title"
              maxLength={120}
              aria-label="project title"
              className="w-full h-9 px-2 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-sm focus-visible:outline-none focus-visible:border-neon-violet"
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
              <Button type="button" onClick={onSaveAndStart} disabled={busy}>
                {busy ? "saving…" : "save & go live"}
              </Button>
            </div>
          </div>
        )}

        {!sessionActive && project && (
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
          <div className="space-y-4">
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
            </div>

            <BuddiesPanel sessionId={session.id ?? ""} />

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

/**
 * Buddies sub-panel rendered inside an active session. Lists buddies
 * with online dots, lets the host fire a real-time invite, surfaces
 * the user's own buddy code for sharing, and exposes an inline
 * "connect with someone" input.
 */
function BuddiesPanel({ sessionId }: { sessionId: string }) {
  const buddies = useBeatsStore((s) => s.buddy.buddies);
  const onlineUids = useBeatsStore((s) => s.buddy.onlineUids);
  const outgoingInvites = useBeatsStore((s) => s.buddy.outgoingInvites);
  const myCode = useBeatsStore((s) => s.buddy.myCode);
  const sendInvite = useBeatsStore((s) => s.sendInvite);
  const submitBuddyCode = useBeatsStore((s) => s.submitBuddyCode);
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [draftCode, setDraftCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tick once per second so countdowns re-render without each row
  // owning its own interval. Cheap — only relevant when a panel is
  // open AND there's at least one outgoing invite.
  const [now, setNow] = useState(() => Date.now());
  const hasOutgoing = Object.keys(outgoingInvites).length > 0;
  useEffect(() => {
    if (!hasOutgoing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasOutgoing]);

  const buddyList = Object.values(buddies).sort((a, b) => {
    const aOnline = onlineUids[a.uid] ? 1 : 0;
    const bOnline = onlineUids[b.uid] ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return a.displayName.localeCompare(b.displayName);
  });

  const onInvite = async (toUid: string) => {
    if (!sessionId) return;
    setInFlight((prev) => new Set(prev).add(toUid));
    try {
      await sendInvite(toUid, sessionId);
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(toUid);
        return next;
      });
    }
  };

  const onCopyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      pushToast("success", "buddy code copied");
    } catch {
      pushToast("warn", "couldn't copy — select and copy manually");
    }
  };

  const onSubmitCode = async () => {
    const trimmed = draftCode.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const ok = await submitBuddyCode(trimmed);
      if (ok) setDraftCode("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-grid">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
          buddies
        </h4>
        {myCode && (
          <button
            type="button"
            onClick={onCopyCode}
            className="text-[10px] font-mono text-ink-dim hover:text-neon-violet transition-colors duration-150 motion-reduce:transition-none"
            aria-label="copy your buddy code"
          >
            your code: <span className="text-ink">{myCode}</span>
          </button>
        )}
      </div>

      {buddyList.length === 0 && (
        <p className="text-ink-muted text-[11px]">
          No buddies yet. Share your code or paste a friend&apos;s code below.
        </p>
      )}

      {buddyList.length > 0 && (
        <ul className="space-y-1.5 max-h-40 overflow-auto">
          {buddyList.map((buddy) => {
            const online = !!onlineUids[buddy.uid];
            const pending = inFlight.has(buddy.uid);
            const outgoing = outgoingInvites[buddy.uid];
            const remaining = outgoing
              ? Math.max(0, Math.ceil((outgoing.expiresAt - now) / 1000))
              : 0;
            const inviteOpen = !!outgoing && remaining > 0;
            const inviteExpired = !!outgoing && remaining === 0;
            return (
              <li key={buddy.uid} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className={clsx(
                    "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                    online ? "bg-neon-green" : "bg-ink-muted/40",
                  )}
                  style={
                    online
                      ? { boxShadow: "0 0 6px var(--neon-green)" }
                      : undefined
                  }
                />
                <span
                  className={clsx(
                    "flex-1 truncate font-mono",
                    online ? "text-ink" : "text-ink-muted",
                  )}
                >
                  {buddy.displayName}
                </span>
                {inviteOpen && (
                  <span
                    className="text-[10px] font-mono text-ink-muted tabular-nums"
                    aria-label={`invite expires in ${remaining}s`}
                  >
                    {Math.floor(remaining / 60)}:
                    {String(remaining % 60).padStart(2, "0")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void onInvite(buddy.uid)}
                  disabled={!online || pending || inviteOpen}
                  className={clsx(
                    "h-7 px-2 rounded border text-[10px] uppercase tracking-widest font-mono transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed",
                    inviteExpired
                      ? "border-neon-sun/70 text-neon-sun hover:bg-neon-sun/10"
                      : "border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet",
                  )}
                >
                  {pending
                    ? "…"
                    : !online
                      ? "offline"
                      : inviteOpen
                        ? "sent"
                        : inviteExpired
                          ? "re-invite"
                          : "invite"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draftCode}
          onChange={(e) => setDraftCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmitCode();
          }}
          placeholder="paste buddy code"
          aria-label="buddy code to add"
          maxLength={20}
          className="flex-1 h-8 px-2 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-xs uppercase placeholder:text-ink-muted/60 focus-visible:outline-none focus-visible:border-neon-violet"
        />
        <Button
          type="button"
          onClick={() => void onSubmitCode()}
          disabled={submitting || !draftCode.trim()}
        >
          {submitting ? "…" : "add"}
        </Button>
      </div>
    </div>
  );
}
