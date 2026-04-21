import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useRouteTracker } from "@/lib/useRouteTracker";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

const navItems = [
  { to: "/", label: "studio", end: true },
  { to: "/gallery", label: "gallery", end: false },
  { to: "/profile", label: "profile", end: false },
];

export function AppShell() {
  const status = useBeatsStore((s) => s.auth.status);
  const user = useBeatsStore((s) => s.auth.user);
  const signInWithGoogle = useBeatsStore((s) => s.signInWithGoogle);
  const signOut = useBeatsStore((s) => s.signOut);
  useRouteTracker();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-grid bg-bg-panel/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-ink text-sm tracking-[0.4em] uppercase">
              <span className="text-neon-magenta">▮</span> beats
            </span>
            <nav className="flex gap-1 text-xs uppercase tracking-widest">
              {navItems.map((item) => (
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

          <div className="flex items-center gap-3">
            {status === "authed" && user ? (
              <>
                <Tooltip label={user.email}>
                  <span className="text-xs text-ink-dim font-mono">
                    {user.displayName}
                  </span>
                </Tooltip>
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
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
