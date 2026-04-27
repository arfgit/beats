import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { BuddyConnection, BuddyRequest } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Standalone "Buddies" drawer — single surface for everything buddy-
 * related: see your code, paste someone else's, accept/decline pending
 * requests, see who's online, drop a buddy. Mounted from the AppShell
 * via a "buddies" button so it works on any route.
 *
 * Mirrors the focus + ESC patterns from InviteDialog so users get
 * predictable keyboard behavior across every modal in the app.
 */
export function BuddyDrawer({ open, onClose }: Props) {
  const myCode = useBeatsStore((s) => s.buddy.myCode);
  const buddies = useBeatsStore((s) => s.buddy.buddies);
  const requests = useBeatsStore((s) => s.buddy.requests);
  const onlineUids = useBeatsStore((s) => s.buddy.onlineUids);
  const submitBuddyCode = useBeatsStore((s) => s.submitBuddyCode);
  const acceptBuddyRequest = useBeatsStore((s) => s.acceptBuddyRequest);
  const declineBuddyRequest = useBeatsStore((s) => s.declineBuddyRequest);
  const removeBuddy = useBeatsStore((s) => s.removeBuddy);
  const pushToast = useBeatsStore((s) => s.pushToast);

  const [draftCode, setDraftCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  // Split requests into incoming and outgoing — the user's intent is
  // very different for each (accept/decline vs cancel + show pending).
  const incoming: BuddyRequest[] = [];
  const outgoing: BuddyRequest[] = [];
  for (const req of Object.values(requests)) {
    (req.direction === "incoming" ? incoming : outgoing).push(req);
  }

  const buddyList: BuddyConnection[] = Object.values(buddies).sort((a, b) => {
    const aOnline = onlineUids[a.uid] ? 1 : 0;
    const bOnline = onlineUids[b.uid] ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return a.displayName.localeCompare(b.displayName);
  });

  const onCopyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      pushToast("success", "buddy code copied");
    } catch {
      pushToast("warn", "couldn't copy — select manually");
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
    <div
      className="fixed inset-0 z-[80] bg-bg-void/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="buddy-drawer-title"
        className={clsx(
          "bg-bg-panel border border-neon-violet rounded p-5 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto",
          "shadow-[var(--glow-violet)]",
        )}
      >
        <header className="flex items-center justify-between">
          <h3
            id="buddy-drawer-title"
            className="text-neon-violet text-sm uppercase tracking-[0.3em]"
          >
            buddies
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

        {/* My code */}
        <section className="space-y-1.5">
          <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
            your buddy code
          </h4>
          {myCode ? (
            <button
              type="button"
              onClick={() => void onCopyCode()}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-grid bg-bg-panel-2 hover:border-neon-violet transition-colors duration-150 motion-reduce:transition-none"
              aria-label="copy your buddy code"
            >
              <span className="font-mono text-base text-ink tracking-[0.2em]">
                {myCode}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
                copy
              </span>
            </button>
          ) : (
            <p className="text-ink-muted text-xs">loading…</p>
          )}
          <p className="text-[10px] text-ink-muted">
            Share this with friends to live-jam together.
          </p>
        </section>

        {/* Add buddy */}
        <section className="space-y-1.5">
          <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
            add a buddy
          </h4>
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
              className="flex-1 h-9 px-2 bg-bg-panel-2 border border-grid rounded text-ink font-mono text-sm uppercase placeholder:text-ink-muted/60 focus-visible:outline-none focus-visible:border-neon-violet"
            />
            <Button
              type="button"
              onClick={() => void onSubmitCode()}
              disabled={submitting || !draftCode.trim()}
            >
              {submitting ? "…" : "send"}
            </Button>
          </div>
        </section>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
              incoming requests ({incoming.length})
            </h4>
            <ul className="space-y-2">
              {incoming.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-grid bg-bg-panel-2"
                >
                  <span className="flex-1 truncate text-sm text-ink font-mono">
                    {req.fromDisplayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => void declineBuddyRequest(req.id)}
                    aria-label={`decline ${req.fromDisplayName}`}
                    className="h-7 px-2 rounded border border-grid text-[10px] uppercase tracking-widest font-mono text-ink-muted hover:border-ink hover:text-ink transition-colors duration-150 motion-reduce:transition-none"
                  >
                    decline
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptBuddyRequest(req.id)}
                    aria-label={`accept ${req.fromDisplayName}`}
                    className="h-7 px-2 rounded border border-neon-violet bg-neon-violet/20 text-[10px] uppercase tracking-widest font-mono text-neon-violet hover:bg-neon-violet/30 transition-colors duration-150 motion-reduce:transition-none"
                  >
                    accept
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Outgoing requests (informational) */}
        {outgoing.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
              waiting for ({outgoing.length})
            </h4>
            <ul className="space-y-1">
              {outgoing.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-2 text-xs text-ink-muted font-mono"
                >
                  <span aria-hidden>·</span>
                  <span className="flex-1 truncate">
                    {req.toUid.slice(0, 8)}…
                  </span>
                  <button
                    type="button"
                    onClick={() => void declineBuddyRequest(req.id)}
                    className="text-[10px] uppercase tracking-widest hover:text-ink"
                    aria-label="cancel request"
                  >
                    cancel
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Buddy list */}
        <section className="space-y-1.5">
          <h4 className="text-[10px] uppercase tracking-widest text-ink-muted font-mono">
            your buddies ({buddyList.length})
          </h4>
          {buddyList.length === 0 ? (
            <p className="text-ink-muted text-xs">
              No buddies yet. Share your code or paste someone else&apos;s
              above.
            </p>
          ) : (
            <ul className="space-y-1">
              {buddyList.map((buddy) => {
                const online = !!onlineUids[buddy.uid];
                return (
                  <li
                    key={buddy.uid}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                  >
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
                    <span
                      className={clsx(
                        "text-[10px] uppercase tracking-widest font-mono",
                        online ? "text-neon-green" : "text-ink-muted",
                      )}
                    >
                      {online ? "online" : "offline"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeBuddy(buddy.uid)}
                      aria-label={`remove ${buddy.displayName}`}
                      className="text-ink-muted hover:text-neon-red text-[10px] font-mono uppercase tracking-widest"
                    >
                      drop
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
