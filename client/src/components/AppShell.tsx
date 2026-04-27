import { useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useRouteTracker } from "@/lib/useRouteTracker";
import { IncomingInviteToast } from "@/features/buddy/IncomingInviteToast";
import { BuddyDrawer } from "@/features/buddy/BuddyDrawer";
import { Button } from "./ui/Button";

interface NavItem {
  to: string;
  label: string;
  end: boolean;
  requiresAuth?: boolean;
}

const navItems: NavItem[] = [
  { to: "/", label: "studio", end: true },
  { to: "/gallery", label: "gallery", end: false },
  { to: "/profile", label: "profile", end: false, requiresAuth: true },
];

export function AppShell() {
  const status = useBeatsStore((s) => s.auth.status);
  const user = useBeatsStore((s) => s.auth.user);
  const errorMessage = useBeatsStore((s) => s.auth.errorMessage);
  const signInWithGoogle = useBeatsStore((s) => s.signInWithGoogle);
  const signOut = useBeatsStore((s) => s.signOut);
  useRouteTracker();

  const isAuthed = status === "authed" && !!user;
  const visibleNavItems = navItems.filter(
    (item) => !item.requiresAuth || isAuthed,
  );
  const [buddyDrawerOpen, setBuddyDrawerOpen] = useState(false);
  const incomingRequestCount = useBeatsStore(
    (s) =>
      Object.values(s.buddy.requests).filter((r) => r.direction === "incoming")
        .length,
  );
  // Watch the global "close all popups" trigger — bumped when something
  // significant happens elsewhere (e.g. user accepted an invite from
  // a toast and we want the BuddyDrawer to stop occluding the studio).
  const popupCloseTrigger = useBeatsStore((s) => s.ui.popupCloseTrigger);
  useEffect(() => {
    if (popupCloseTrigger === 0) return;
    setBuddyDrawerOpen(false);
    setMenuOpen(false);
  }, [popupCloseTrigger]);

  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const drawerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Session-leave confirmation. The "studio" nav link routes to "/"
  // (fresh solo project). When the user is mid-jam and clicks it, we
  // intercept to confirm the abandon — losing your spot in a live
  // session unintentionally is a high-pain mistake.
  const liveSessionId = useBeatsStore((s) => s.collab.session.id);
  const leaveSession = useBeatsStore((s) => s.leaveSession);
  const navigate = useNavigate();
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [leavingSession, setLeavingSession] = useState(false);
  const handleNavRequest = (to: string, end: boolean) => {
    // Only the "/" + end:true link is the studio route. Other items
    // (gallery, profile) still fall under the same "leave?" prompt
    // because navigating away from /studio/<id> while in session
    // would silently drop the user from the jam too.
    void end;
    return liveSessionId ? to : null;
  };
  const confirmLeave = async () => {
    if (!leaveTarget || leavingSession) return;
    setLeavingSession(true);
    await leaveSession();
    setLeavingSession(false);
    const target = leaveTarget;
    setLeaveTarget(null);
    navigate(target);
  };

  // Close the mobile menu on route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // ESC close + body scroll lock + focus trap while open.
  useEffect(() => {
    if (!menuOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusablesSelector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusables =
        drawerRef.current.querySelectorAll<HTMLElement>(focusablesSelector);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    // Move focus into the drawer after the transition starts.
    queueMicrotask(() => {
      const first =
        drawerRef.current?.querySelector<HTMLElement>(focusablesSelector);
      first?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      returnFocusRef.current?.focus?.();
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-grid bg-bg-panel/60 backdrop-blur-sm relative z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            <span className="text-ink text-sm tracking-[0.4em] uppercase whitespace-nowrap">
              <span className="text-neon-magenta">▮</span> beats
            </span>
            {/* Desktop nav — hidden below sm, mobile menu handles it there */}
            <nav
              className="hidden sm:flex gap-1 text-xs uppercase tracking-widest"
              aria-label="primary"
            >
              {visibleNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={(e) => {
                    const intercept = handleNavRequest(item.to, item.end);
                    if (!intercept) return;
                    e.preventDefault();
                    setLeaveTarget(intercept);
                  }}
                  className={({ isActive }) =>
                    clsx(
                      "px-3 py-1.5 rounded transition-colors duration-200 ease-in",
                      "motion-reduce:transition-none",
                      isActive
                        ? "text-neon-cyan"
                        : "text-ink-muted hover:text-ink-dim",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Desktop auth — hidden below sm */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            {status === "authed" && user ? (
              <DesktopUserMenu
                displayName={user.displayName}
                onSignOut={() => void signOut()}
                onOpenBuddies={() => setBuddyDrawerOpen(true)}
                incomingRequestCount={incomingRequestCount}
              />
            ) : status === "loading" ? (
              <span className="text-xs text-ink-muted">…</span>
            ) : status === "error" ? (
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] text-neon-red uppercase tracking-widest max-w-[160px] truncate"
                  title={errorMessage ?? "sign-in failed"}
                >
                  {errorMessage ?? "sign-in failed"}
                </span>
                <Button onClick={() => void signInWithGoogle()}>retry</Button>
              </div>
            ) : (
              <Button onClick={() => void signInWithGoogle()}>
                sign in with google
              </Button>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="sm:hidden h-9 w-9 flex flex-col items-center justify-center gap-1 rounded border border-grid text-ink-dim hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none"
            aria-label={menuOpen ? "close menu" : "open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span
              aria-hidden
              className={clsx(
                "block h-0.5 w-4 bg-current transition-transform duration-200 ease-in motion-reduce:transition-none",
                menuOpen && "translate-y-[3px] rotate-45",
              )}
            />
            <span
              aria-hidden
              className={clsx(
                "block h-0.5 w-4 bg-current transition-opacity duration-200 ease-in motion-reduce:transition-none",
                menuOpen && "opacity-0",
              )}
            />
            <span
              aria-hidden
              className={clsx(
                "block h-0.5 w-4 bg-current transition-transform duration-200 ease-in motion-reduce:transition-none",
                menuOpen && "-translate-y-[7px] -rotate-45",
              )}
            />
          </button>
        </div>
      </header>

      {/* Mobile slide-in nav + backdrop */}
      <div
        className={clsx(
          // z-[100] sits above InviteDialog (z-[80]) but stays below the
          // Toaster (z-[9999]) and Tooltip portals so transient feedback
          // is still visible while the drawer is open.
          "fixed inset-0 z-[100] sm:hidden transition-opacity duration-200 ease-in motion-reduce:transition-none",
          menuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!menuOpen}
      >
        <button
          type="button"
          className="absolute inset-0 bg-bg-void/70 backdrop-blur-sm"
          aria-label="close menu"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
        />
        <aside
          ref={drawerRef}
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="site navigation"
          className={clsx(
            "absolute top-0 right-0 h-full w-[280px] max-w-[85vw] bg-bg-panel border-l border-grid p-6 flex flex-col gap-6",
            "transition-transform duration-250 ease-out motion-reduce:transition-none",
            menuOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <span className="text-ink-muted text-[10px] uppercase tracking-[0.3em]">
            navigate
          </span>
          <nav
            className="flex flex-col gap-1 text-sm uppercase tracking-widest"
            aria-label="primary"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={(e) => {
                  const intercept = handleNavRequest(item.to, item.end);
                  if (!intercept) return;
                  e.preventDefault();
                  setLeaveTarget(intercept);
                }}
                className={({ isActive }) =>
                  clsx(
                    "px-3 py-2.5 rounded border transition-colors duration-200 ease-in",
                    "motion-reduce:transition-none",
                    isActive
                      ? "border-neon-cyan text-neon-cyan"
                      : "border-grid text-ink-dim hover:border-ink-dim hover:text-ink",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto border-t border-grid pt-4">
            {status === "authed" && user ? (
              <div className="flex flex-col gap-3">
                <span className="text-[10px] uppercase tracking-widest text-ink-muted">
                  signed in as
                </span>
                <span className="text-sm text-ink font-mono truncate">
                  {user.displayName}
                </span>
                <BuddyCodeChip />
                <Button
                  variant="ghost"
                  onClick={() => setBuddyDrawerOpen(true)}
                  aria-label={
                    incomingRequestCount > 0
                      ? `buddies (${incomingRequestCount} pending)`
                      : "buddies"
                  }
                >
                  <span className="flex items-center justify-between gap-2 w-full">
                    <span>buddies</span>
                    {incomingRequestCount > 0 && (
                      <span
                        aria-hidden
                        className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-neon-violet text-bg-void text-[10px] font-mono font-medium"
                      >
                        {incomingRequestCount}
                      </span>
                    )}
                  </span>
                </Button>
                <Button variant="ghost" onClick={() => void signOut()}>
                  sign out
                </Button>
              </div>
            ) : status === "loading" ? (
              <span className="text-xs text-ink-muted">loading…</span>
            ) : status === "error" ? (
              <div className="flex flex-col gap-3">
                <span className="text-[10px] uppercase tracking-widest text-neon-red">
                  sign-in failed
                </span>
                <span className="text-[10px] text-ink-muted break-words">
                  {errorMessage ?? "an error occurred — please try again"}
                </span>
                <Button
                  onClick={() => void signInWithGoogle()}
                  className="w-full"
                >
                  retry
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => void signInWithGoogle()}
                className="w-full"
              >
                sign in with google
              </Button>
            )}
          </div>
        </aside>
      </div>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
      <IncomingInviteToast />
      <BuddyDrawer
        open={buddyDrawerOpen}
        onClose={() => setBuddyDrawerOpen(false)}
      />
      <BuddyNavigationBridge />
      {leaveTarget && (
        <LeaveSessionConfirmModal
          isLeaving={leavingSession}
          onConfirm={() => void confirmLeave()}
          onCancel={() => {
            if (leavingSession) return;
            setLeaveTarget(null);
          }}
        />
      )}
    </div>
  );
}

function LeaveSessionConfirmModal({
  isLeaving,
  onConfirm,
  onCancel,
}: {
  isLeaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby={titleId}
      className={clsx(
        "fixed m-auto rounded-lg border border-neon-violet/70 bg-bg-panel p-6 shadow-xl shadow-black/60",
        "w-full max-w-sm",
        "backdrop:bg-bg-void/75 backdrop:backdrop-blur-sm",
        "focus-visible:outline-none",
      )}
    >
      <h3
        id={titleId}
        className="mb-1 font-mono text-sm uppercase tracking-widest text-neon-violet"
      >
        leave the jam?
      </h3>
      <p className="mb-5 text-[11px] text-ink-muted">
        You&apos;re in a live session. Continuing will drop you out of the jam
        and open a fresh solo studio. Other peers stay connected.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          disabled={isLeaving}
          className="h-8 px-3 rounded border border-grid font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet disabled:opacity-50 disabled:cursor-not-allowed"
        >
          stay
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLeaving}
          className="h-8 px-3 rounded border border-neon-violet/70 font-mono text-[10px] uppercase tracking-widest text-neon-violet hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLeaving ? "leaving…" : "leave jam"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * Desktop user dropdown — shows on click of the username button. The
 * mobile slide-in sidebar has its own copy of the same affordances
 * (buddy code chip + buddies + sign out) so this dropdown is purely
 * the desktop surface.
 *
 * Click-outside + ESC close + focus management lives here. The
 * trigger is a real `<button>` with `aria-expanded` + `aria-haspopup`
 * so screen readers announce it as a menu opener.
 */
function DesktopUserMenu({
  displayName,
  onSignOut,
  onOpenBuddies,
  incomingRequestCount,
}: {
  displayName: string;
  onSignOut: () => void;
  onOpenBuddies: () => void;
  incomingRequestCount: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (evt: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(evt.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`account menu for ${displayName}`}
        className={clsx(
          "h-9 px-3 flex items-center gap-2 rounded border bg-bg-panel-2 font-mono text-xs",
          "transition-colors duration-150 motion-reduce:transition-none",
          open
            ? "border-neon-violet text-ink"
            : "border-grid text-ink-dim hover:border-ink-dim hover:text-ink",
        )}
      >
        <span className="truncate max-w-[160px]">{displayName}</span>
        {incomingRequestCount > 0 && (
          <span
            aria-hidden
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-neon-violet text-bg-void text-[10px] font-medium"
            title={`${incomingRequestCount} pending buddy request${incomingRequestCount === 1 ? "" : "s"}`}
          >
            {incomingRequestCount}
          </span>
        )}
        <span
          aria-hidden
          className={clsx(
            "text-ink-muted transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="account menu"
          className="absolute right-0 top-full mt-2 w-56 rounded border border-neon-violet bg-bg-panel shadow-[var(--glow-violet)] py-2 z-50"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-ink-muted font-mono">
            signed in
          </div>
          <div className="px-3 pb-2 text-sm text-ink font-mono truncate">
            {displayName}
          </div>
          <div className="px-3 pb-2">
            <BuddyCodeChip />
          </div>
          <div className="border-t border-grid my-1" />
          <NavLink
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx(
                "block px-3 py-2 text-sm font-mono transition-colors duration-150 motion-reduce:transition-none",
                isActive
                  ? "text-neon-violet"
                  : "text-ink-dim hover:bg-bg-panel-2 hover:text-ink",
              )
            }
          >
            profile
          </NavLink>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenBuddies();
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-mono text-ink-dim hover:bg-bg-panel-2 hover:text-ink transition-colors duration-150 motion-reduce:transition-none"
          >
            <span>buddies</span>
            {incomingRequestCount > 0 && (
              <span
                aria-hidden
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-neon-violet text-bg-void text-[10px] font-medium"
              >
                {incomingRequestCount}
              </span>
            )}
          </button>
          <div className="border-t border-grid my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="w-full text-left px-3 py-2 text-sm font-mono text-ink-dim hover:bg-bg-panel-2 hover:text-neon-red transition-colors duration-150 motion-reduce:transition-none"
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Buddy code chip — displays the user's BX-XXXXX code with copy-on-click.
 * Hidden when the code hasn't loaded yet. The slice's
 * `attachBuddyListeners` lazy-loads the code on auth login so this
 * rarely shows the empty state.
 */
function BuddyCodeChip() {
  const code = useBeatsStore((s) => s.buddy.myCode);
  const pushToast = useBeatsStore((s) => s.pushToast);
  if (!code) return null;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      pushToast("success", "buddy code copied");
    } catch {
      pushToast("warn", "couldn't copy — select manually");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label="copy your buddy code"
      title="your buddy code — share with friends to live-jam together"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-grid bg-bg-panel-2 text-[10px] font-mono text-ink-dim hover:border-neon-violet hover:text-neon-violet transition-colors duration-150 motion-reduce:transition-none self-start"
    >
      <span aria-hidden className="text-ink-muted">
        code
      </span>
      <span className="text-ink">{code}</span>
    </button>
  );
}

/**
 * Tiny effect that watches `buddy.pendingNavigation` and routes the
 * tab there once. Keeps the buddy slice framework-agnostic — it sets
 * a string, this component dispatches the actual `useNavigate` call.
 */
function BuddyNavigationBridge() {
  const navigate = useNavigate();
  const pending = useBeatsStore((s) => s.buddy.pendingNavigation);
  const consumePendingNavigation = useBeatsStore(
    (s) => s.consumePendingNavigation,
  );
  useEffect(() => {
    if (!pending) return;
    const target = consumePendingNavigation();
    if (target) navigate(target, { replace: false });
  }, [pending, navigate, consumePendingNavigation]);
  return null;
}
