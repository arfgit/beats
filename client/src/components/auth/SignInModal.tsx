import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "../ui/Button";

type Mode = "signin" | "signup" | "forgot";
type Tab = "email" | "google";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Sign-in / sign-up entry point. Two providers in v1: Email/Password
 * and Google. Phone is on the v1.1 backlog.
 *
 * Username collection deliberately doesn't live here — after a
 * successful sign-up, /auth/session returns a User with username=""
 * and the AppShell renders the UsernameOnboarding takeover. This
 * keeps the sign-in form short for returning users (the common case)
 * and routes both new and migrating users through the same onboarding
 * surface.
 */
export function SignInModal({ open, onClose }: Props) {
  const titleId = useId();
  const status = useBeatsStore((s) => s.auth.status);
  const errorMessage = useBeatsStore((s) => s.auth.errorMessage);
  const signInWithGoogle = useBeatsStore((s) => s.signInWithGoogle);
  const signInWithPassword = useBeatsStore((s) => s.signInWithPassword);
  const signUpWithPassword = useBeatsStore((s) => s.signUpWithPassword);
  const sendPasswordReset = useBeatsStore((s) => s.sendPasswordReset);

  const [mode, setMode] = useState<Mode>("signin");
  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const submitting = status === "loading";
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Reset transient state on open/close so the modal doesn't replay
  // a prior error or pre-fill stale credentials.
  useEffect(() => {
    if (!open) return;
    setMode("signin");
    setTab("email");
    setPassword("");
    setResetSent(false);
    setResetError(null);
  }, [open]);

  // Auto-close after auth flips to authed/needsUsername. The Outlet /
  // UsernameOnboarding takes over from there.
  useEffect(() => {
    if (!open) return;
    if (status === "authed" || status === "needsUsername") onClose();
  }, [open, status, onClose]);

  // Focus the first input on open, restore focus to the trigger on close.
  // Per accessibility rules: trap focus, ESC closes, restore on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signin") {
      await signInWithPassword(email.trim(), password);
    } else if (mode === "signup") {
      await signUpWithPassword(email.trim(), password);
    }
  };

  const onForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetSent(false);
    try {
      await sendPasswordReset(email.trim());
      setResetSent(true);
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : "couldn't send reset email",
      );
    }
  };

  const titleByMode: Record<Mode, string> = {
    signin: "sign in",
    signup: "create account",
    forgot: "reset password",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        // Overlay click closes; clicks inside the dialog don't bubble out.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-bg-void/80 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          "relative w-[min(440px,calc(100vw-2rem))] rounded border border-grid",
          "bg-bg-panel shadow-[var(--glow-violet)] p-6 z-10",
          "font-mono",
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            id={titleId}
            className="text-sm uppercase tracking-widest text-neon-violet"
          >
            {titleByMode[mode]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="h-7 w-7 flex items-center justify-center rounded border border-grid text-ink-dim hover:border-ink-dim hover:text-ink transition-colors duration-150 motion-reduce:transition-none"
          >
            ×
          </button>
        </div>

        {mode !== "forgot" && (
          <div className="flex gap-1 mb-4 text-xs">
            <button
              type="button"
              onClick={() => setTab("email")}
              aria-pressed={tab === "email"}
              className={clsx(
                "flex-1 px-3 py-2 rounded uppercase tracking-wider transition-colors duration-150 motion-reduce:transition-none",
                tab === "email"
                  ? "bg-bg-panel-2 text-ink border border-neon-violet"
                  : "border border-grid text-ink-muted hover:text-ink-dim hover:border-ink-dim",
              )}
            >
              email
            </button>
            <button
              type="button"
              onClick={() => setTab("google")}
              aria-pressed={tab === "google"}
              className={clsx(
                "flex-1 px-3 py-2 rounded uppercase tracking-wider transition-colors duration-150 motion-reduce:transition-none",
                tab === "google"
                  ? "bg-bg-panel-2 text-ink border border-neon-violet"
                  : "border border-grid text-ink-muted hover:text-ink-dim hover:border-ink-dim",
              )}
            >
              google
            </button>
          </div>
        )}

        {tab === "google" && mode !== "forgot" ? (
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => void signInWithGoogle()}
              disabled={submitting}
              className="w-full"
            >
              continue with google
            </Button>
            {status === "error" && errorMessage && (
              <p className="text-[11px] text-neon-red break-words">
                {errorMessage}
              </p>
            )}
          </div>
        ) : mode === "forgot" ? (
          <form onSubmit={onForgotSubmit} className="flex flex-col gap-3">
            <Field
              ref={firstFieldRef}
              label="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Button
              type="submit"
              disabled={submitting || !email}
              className="w-full"
            >
              send reset email
            </Button>
            {resetSent && (
              <p className="text-[11px] text-neon-cyan">
                reset email sent — check your inbox
              </p>
            )}
            {resetError && (
              <p className="text-[11px] text-neon-red break-words">
                {resetError}
              </p>
            )}
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="text-[11px] text-ink-muted hover:text-ink-dim self-start"
            >
              ← back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={onPasswordSubmit} className="flex flex-col gap-3">
            <Field
              ref={firstFieldRef}
              label="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              label="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={setPassword}
              required
              minLength={mode === "signup" ? 6 : undefined}
              hint={mode === "signup" ? "at least 6 characters" : undefined}
            />
            <Button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full"
            >
              {mode === "signin" ? "sign in" : "create account"}
            </Button>
            {status === "error" && errorMessage && (
              <p className="text-[11px] text-neon-red break-words">
                {errorMessage}
              </p>
            )}
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              {mode === "signin" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="hover:text-ink-dim"
                  >
                    forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="hover:text-ink-dim"
                  >
                    create account
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="hover:text-ink-dim"
                >
                  ← back to sign in
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface FieldProps {
  label: string;
  type: "email" | "password" | "text";
  autoComplete?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  hint?: string;
}

const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, type, autoComplete, value, onChange, required, minLength, hint },
  ref,
) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-ink-muted">
        {label}
      </span>
      <input
        ref={ref}
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        className={clsx(
          "h-9 px-2 rounded bg-bg-panel-2 border border-grid",
          "text-sm text-ink font-mono",
          "focus-visible:outline-none focus-visible:border-neon-violet",
          "placeholder:text-ink-muted",
        )}
      />
      {hint && <span className="text-[10px] text-ink-muted">{hint}</span>}
    </label>
  );
});
