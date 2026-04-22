import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useRouteTracker } from "@/lib/useRouteTracker";
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
  const signInWithGoogle = useBeatsStore((s) => s.signInWithGoogle);
  const signOut = useBeatsStore((s) => s.signOut);
  useRouteTracker();

  const isAuthed = status === "authed" && !!user;
  const visibleNavItems = navItems.filter(
    (item) => !item.requiresAuth || isAuthed,
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const drawerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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
              <>
                <NavLink
                  to="/profile"
                  className="text-xs text-ink-dim font-mono truncate max-w-[160px] hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none"
                >
                  {user.displayName}
                </NavLink>
                <Button variant="ghost" onClick={() => void signOut()}>
                  sign out
                </Button>
              </>
            ) : status === "loading" ? (
              <span className="text-xs text-ink-muted">…</span>
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
                <Button variant="ghost" onClick={() => void signOut()}>
                  sign out
                </Button>
              </div>
            ) : status === "loading" ? (
              <span className="text-xs text-ink-muted">loading…</span>
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
    </div>
  );
}
