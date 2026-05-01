import { useEffect, useId, useRef, useState } from "react";
import { useBeatsStore } from "@/store/useBeatsStore";
import {
  suggestUsernameFrom,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validateUsername,
} from "@beats/shared";
import { api, ApiCallError } from "@/lib/api";
import { Button } from "../ui/Button";

const AVAILABILITY_DEBOUNCE_MS = 350;

type AvailabilityState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

/**
 * Full-screen takeover that blocks the app shell when the signed-in
 * user hasn't claimed a username yet (auth.status === "needsUsername").
 *
 * Two entry paths converge here:
 *  - first-time email sign-up — input starts empty.
 *  - migrating Google user — input pre-filled from displayName via
 *    suggestUsernameFrom; user can accept or edit before claiming.
 *
 * Sign-out is the only escape hatch (per codex's review) so a user
 * who can't pick a name they're happy with isn't stuck.
 */
export function UsernameOnboarding() {
  const titleId = useId();
  const inputId = useId();
  const user = useBeatsStore((s) => s.auth.user);
  const claimUsername = useBeatsStore((s) => s.claimUsername);
  const signOut = useBeatsStore((s) => s.signOut);

  const initialSuggestion = user ? suggestUsernameFrom(user.displayName) : "";
  const [value, setValue] = useState(initialSuggestion);
  const [availability, setAvailability] = useState<AvailabilityState>({
    kind: "idle",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the input on mount so a returning user can hit Enter.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced availability check. Local validation runs immediately so
  // bad input doesn't waste a server round-trip; the network call only
  // fires once the value passes the regex.
  useEffect(() => {
    if (!value) {
      setAvailability({ kind: "idle" });
      return;
    }
    const validation = validateUsername(value);
    if (!validation.ok) {
      setAvailability({ kind: "invalid", message: validation.message });
      return;
    }
    setAvailability({ kind: "checking" });
    const handle = validation.normalized;
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean }>(
          `/auth/check-username/${encodeURIComponent(handle)}`,
        );
        // Drop the response if the user kept typing — a faster check
        // for the new value will overwrite this one shortly.
        if (validateUsername(value).ok) {
          setAvailability(
            result.available ? { kind: "available" } : { kind: "taken" },
          );
        }
      } catch (err) {
        const message =
          err instanceof ApiCallError
            ? err.apiError.message
            : "couldn't check availability";
        setAvailability({ kind: "error", message });
      }
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (availability.kind !== "available") return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await claimUsername(value);
      // Slice flips status to "authed" on success; the AppShell then
      // unmounts this takeover.
    } catch (err) {
      // The most common failure here is a race lost — someone claimed
      // the same handle in the gap between the availability probe and
      // the claim. Show the error inline and reset availability so the
      // user can pick something else.
      const message =
        err instanceof ApiCallError
          ? err.apiError.message
          : "couldn't claim that username";
      setSubmitError(message);
      setAvailability({ kind: "taken" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-void/95 backdrop-blur-sm"
    >
      <div className="w-[min(480px,calc(100vw-2rem))] rounded border border-grid bg-bg-panel shadow-[var(--glow-violet)] p-6 font-mono">
        <h2
          id={titleId}
          className="text-sm uppercase tracking-widest text-neon-violet mb-2"
        >
          pick a username
        </h2>
        <p className="text-xs text-ink-dim mb-4">
          this is your public handle on beats — used in your profile URL and
          shown next to your beats. lowercase letters, digits, and hyphens;{" "}
          {USERNAME_MIN_LENGTH}–{USERNAME_MAX_LENGTH} characters.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label htmlFor={inputId} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              username
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={USERNAME_MAX_LENGTH}
              className="h-10 px-3 rounded bg-bg-panel-2 border border-grid text-sm text-ink font-mono focus-visible:outline-none focus-visible:border-neon-violet"
              aria-describedby={`${inputId}-status`}
            />
          </label>
          <p
            id={`${inputId}-status`}
            className="text-[11px] min-h-[1em]"
            aria-live="polite"
          >
            {availability.kind === "checking" && (
              <span className="text-ink-muted">checking…</span>
            )}
            {availability.kind === "available" && (
              <span className="text-neon-cyan">available</span>
            )}
            {availability.kind === "taken" && (
              <span className="text-neon-red">already taken</span>
            )}
            {availability.kind === "invalid" && (
              <span className="text-neon-red">{availability.message}</span>
            )}
            {availability.kind === "error" && (
              <span className="text-neon-red">{availability.message}</span>
            )}
          </p>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-[11px] text-ink-muted hover:text-ink-dim font-mono"
            >
              sign out instead
            </button>
            <Button
              type="submit"
              disabled={availability.kind !== "available" || submitting}
            >
              claim
            </Button>
          </div>
          {submitError && (
            <p className="text-[11px] text-neon-red break-words">
              {submitError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
