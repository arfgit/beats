import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

/**
 * Watches `?session=<id>` on the studio URL. When present and we're
 * not already in that session, surface an explicit confirmation modal
 * — auto-join would surprise users who clicked a link expecting to
 * just view the project.
 *
 * The projectId comes from the route params, NOT from the store's
 * `project.current.id`. Invitees who aren't on the project's
 * collaborator list legitimately have `project.current === null`
 * (Studio.tsx skips loadProject for them to dodge a Firestore deny
 * loop). Reading from the URL keeps the prompt visible regardless
 * of Firestore access.
 *
 * After accept, we deliberately do NOT strip `?session=` from the URL.
 * Doing so used to retrigger the Studio mount effect (joiningSessionId
 * dep flipped to null, cleanup ran clearProject + rehydrateFromLocalCache,
 * which clobbered the just-applied snapshot). The component handles
 * "already in this session" via the `activeSessionId === sessionParam`
 * short-circuit below — refreshing or revisiting the URL just no-ops.
 */
export function SessionJoinPrompt() {
  const location = useLocation();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  const activeSessionId = useBeatsStore((s) => s.collab.session.id);
  const joinSession = useBeatsStore((s) => s.joinSession);
  const pushToast = useBeatsStore((s) => s.pushToast);

  const params = new URLSearchParams(location.search);
  const sessionParam = params.get("session");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissed flag if the session param ever changes — a
  // fresh URL means a fresh prompt.
  useEffect(() => {
    setDismissed(false);
  }, [sessionParam]);

  if (!sessionParam || dismissed) return null;
  if (!myUid) {
    // Without auth we can't join — the prompt would dead-end. Strip
    // the param so the user isn't stuck staring at it after sign-in.
    return (
      <div
        className="fixed inset-0 z-[80] bg-bg-void/80 backdrop-blur-sm flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-sm space-y-3 shadow-[var(--glow-violet)]">
          <h3 className="text-neon-violet text-sm uppercase tracking-[0.3em]">
            sign in to join
          </h3>
          <p className="text-ink-dim text-xs">
            Sessions are sign-in only. Use the sign-in button at the top right,
            then refresh this page.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDismissed(true)}
            >
              dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (activeSessionId === sessionParam) return null;
  // Don't prompt while another session is active — the user has to
  // explicitly leave first to avoid the half-state of being half-in
  // two sessions.
  if (activeSessionId && activeSessionId !== sessionParam) {
    return (
      <div
        className="fixed inset-0 z-[80] bg-bg-void/80 backdrop-blur-sm flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-sm space-y-3 shadow-[var(--glow-violet)]">
          <h3 className="text-neon-violet text-sm uppercase tracking-[0.3em]">
            already in a session
          </h3>
          <p className="text-ink-dim text-xs">
            Leave the current session before joining a new one.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDismissed(true)}
            >
              dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!routeProjectId) return null;

  const onAccept = async () => {
    setBusy(true);
    try {
      const ok = await joinSession(sessionParam);
      if (!ok) {
        pushToast("error", "couldn't join — link may have expired");
      } else {
        pushToast("success", "joined live session");
      }
    } finally {
      setBusy(false);
      // Mark dismissed (instead of stripping the URL) so the prompt
      // doesn't re-render. Leaving the URL intact means a refresh
      // doesn't re-fire the Studio mount cleanup, which would clobber
      // the snapshot we just applied. The prompt's own
      // `activeSessionId === sessionParam` short-circuit handles the
      // "already in this session" case on refresh.
      setDismissed(true);
    }
  };

  const onDecline = () => {
    setDismissed(true);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-bg-void/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-title"
    >
      <div
        className={clsx(
          "bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-sm space-y-4",
          "shadow-[var(--glow-violet)]",
        )}
      >
        <h3
          id="join-title"
          className="text-neon-violet text-sm uppercase tracking-[0.3em]"
        >
          join live session?
        </h3>
        <p className="text-ink-dim text-xs">
          You&apos;ll see other peers&apos; cursors and edits in real time.
          Anything you change will broadcast to them too.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onDecline}
            disabled={busy}
          >
            no thanks
          </Button>
          <Button type="button" onClick={onAccept} disabled={busy}>
            {busy ? "joining…" : "join"}
          </Button>
        </div>
      </div>
    </div>
  );
}
