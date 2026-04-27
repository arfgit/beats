import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { IncomingInvite } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";

/**
 * Top-right stack of "X invited you to <project>" toasts. Shows up to
 * three at once with a "+N more" footer when more pile up. Each card
 * has accept / decline buttons + a countdown derived from the invite's
 * expiresAt. Lives in AppShell so it renders on every route — peers
 * can land an invite while you're on /gallery / /profile / wherever.
 *
 * Mirrors the existing focus + reduced-motion patterns used in other
 * dialogs in the studio.
 */
export function IncomingInviteToast() {
  const inviteMap = useBeatsStore((s) => s.buddy.incomingInvites);
  const acceptIncomingInvite = useBeatsStore((s) => s.acceptIncomingInvite);
  const declineIncomingInvite = useBeatsStore((s) => s.declineIncomingInvite);

  // Snapshot to a sorted array so the render order is stable —
  // newest at the top of the stack reads naturally.
  const invites = useMemo(
    () => Object.values(inviteMap).sort((a, b) => b.createdAt - a.createdAt),
    [inviteMap],
  );

  if (invites.length === 0) return null;

  const visible = invites.slice(0, 3);
  const overflow = invites.length - visible.length;

  return (
    <div
      role="region"
      aria-label="incoming invites"
      aria-live="polite"
      className="fixed top-4 right-4 z-[90] flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {visible.map((invite) => (
        <InviteCard
          key={invite.id}
          invite={invite}
          onAccept={() => void acceptIncomingInvite(invite)}
          onDecline={() => void declineIncomingInvite(invite.id)}
        />
      ))}
      {overflow > 0 && (
        <div className="text-[10px] uppercase tracking-widest font-mono text-ink-muted text-right pr-1 pointer-events-none">
          +{overflow} more
        </div>
      )}
    </div>
  );
}

function InviteCard({
  invite,
  onAccept,
  onDecline,
}: {
  invite: IncomingInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.ceil((invite.expiresAt - now) / 1000));
  const expired = remaining === 0;

  return (
    <div
      role="dialog"
      aria-modal={false}
      aria-labelledby={`invite-${invite.id}-title`}
      className={clsx(
        "pointer-events-auto bg-bg-panel border border-neon-violet rounded p-3 shadow-[var(--glow-violet)]",
        "transition-opacity duration-200 motion-reduce:transition-none",
        expired ? "opacity-60" : "opacity-100",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={invite.fromDisplayName} photoUrl={invite.fromPhotoUrl} />
        <div className="flex-1 min-w-0">
          <p
            id={`invite-${invite.id}-title`}
            className="text-[11px] uppercase tracking-widest text-neon-violet font-mono"
          >
            live session
          </p>
          <p className="text-ink text-sm font-medium truncate mt-0.5">
            <span className="text-ink">{invite.fromDisplayName}</span>
            <span className="text-ink-muted"> invited you to </span>
            <span className="text-ink">{invite.projectTitle}</span>
          </p>
          <p className="text-[10px] text-ink-muted font-mono mt-1">
            {expired ? "expired" : `expires in ${remaining}s`}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={onDecline}
          className="h-9 px-3 rounded border border-grid text-[11px] uppercase tracking-widest font-mono text-ink-muted hover:border-ink hover:text-ink transition-colors duration-150 motion-reduce:transition-none min-w-[44px]"
        >
          decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={expired}
          className="h-9 px-3 rounded border border-neon-violet bg-neon-violet/20 text-[11px] uppercase tracking-widest font-mono text-neon-violet hover:bg-neon-violet/30 transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed min-w-[44px]"
        >
          accept
        </button>
      </div>
    </div>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="h-9 w-9 rounded-full object-cover border border-grid shrink-0"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className="h-9 w-9 rounded-full bg-bg-panel-2 border border-grid flex items-center justify-center text-ink-dim font-mono text-sm shrink-0"
    >
      {initial}
    </div>
  );
}
