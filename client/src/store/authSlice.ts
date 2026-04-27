import type { StateCreator } from "zustand";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onIdTokenChanged,
  type User as FbUser,
  type AuthError,
} from "firebase/auth";
import type { User } from "@beats/shared";
import { auth, googleProvider } from "@/lib/firebase";
import { api, ApiCallError } from "@/lib/api";

export type AuthStatus = "idle" | "loading" | "authed" | "anon" | "error";

export interface AuthSlice {
  auth: {
    user: User | null;
    fbUser: FbUser | null;
    status: AuthStatus;
    errorMessage: string | null;
  };
  bootAuth: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

// Narrow list: only codes that actually indicate the popup channel is
// unavailable. `auth/internal-error` is too broad and would mask real
// config issues by quietly redirecting the user away. `popup-closed-by-user`
// is excluded because a user dismissing the popup is a cancellation, not a
// signal that popups don't work — redirecting them anyway would remove their
// ability to abort sign-in.
const POPUP_FAILURE_CODES = new Set([
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
]);

function isAuthError(err: unknown): err is AuthError {
  return typeof err === "object" && err !== null && "code" in err;
}

function isCoopPopupFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Chrome's COOP warning shows up as an Error with this text but no
  // auth/* code; detect it narrowly rather than catching all internal errors.
  return /window\.closed|window\.close|Cross-Origin-Opener-Policy/i.test(
    err.message ?? "",
  );
}

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (
  set,
) => ({
  auth: { user: null, fbUser: null, status: "idle", errorMessage: null },

  bootAuth: () => {
    set((s) => ({ auth: { ...s.auth, status: "loading" } }));

    let unsub: (() => void) | null = null;

    // Resolve any pending redirect credential BEFORE subscribing to token
    // changes, so onIdTokenChanged's first emission sees the signed-in user
    // rather than firing with null and triggering a 401 on /api/auth/session.
    const ready = getRedirectResult(auth).catch((err) => {
      console.warn("[auth] getRedirectResult failed", err);
      return null;
    });

    void ready.finally(() => {
      unsub = onIdTokenChanged(auth, async (fbUser) => {
        if (!fbUser) {
          set({
            auth: {
              user: null,
              fbUser: null,
              status: "anon",
              errorMessage: null,
            },
          });
          return;
        }
        try {
          // Pass the ID token explicitly instead of relying on api.ts to
          // read `auth.currentUser` — avoids a race where currentUser is
          // still null in the brief window after the token emission.
          const idToken = await fbUser.getIdToken();
          const user = await api.post<User>("/auth/session", undefined, {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          set({
            auth: { user, fbUser, status: "authed", errorMessage: null },
          });
        } catch (err) {
          const message =
            err instanceof ApiCallError
              ? err.apiError.message
              : "session error";
          set({
            auth: {
              user: null,
              fbUser,
              status: "error",
              errorMessage: message,
            },
          });
        }
      });
    });

    return () => unsub?.();
  },

  signInWithGoogle: async () => {
    set((s) => ({
      auth: { ...s.auth, status: "loading", errorMessage: null },
    }));
    try {
      await signInWithPopup(auth, googleProvider);
      // onIdTokenChanged handles the rest.
    } catch (err) {
      const code = isAuthError(err) ? err.code : "";
      if (POPUP_FAILURE_CODES.has(code) || isCoopPopupFailure(err)) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          const message =
            redirectErr instanceof Error
              ? redirectErr.message
              : "sign-in failed";
          set((s) => ({
            auth: { ...s.auth, status: "error", errorMessage: message },
          }));
          return;
        }
      }
      // User cancellation (closed the popup) is not an error — just return
      // to the anon state so the sign-in button reappears.
      if (code === "auth/popup-closed-by-user") {
        set((s) => ({
          auth: { ...s.auth, status: "anon", errorMessage: null },
        }));
        return;
      }
      const message = err instanceof Error ? err.message : "sign-in failed";
      set((s) => ({
        auth: { ...s.auth, status: "error", errorMessage: message },
      }));
    }
  },

  signOut: async () => {
    // Drop out of any live session before tearing down the auth.
    // Without this, the participant slot lingers (until the websocket
    // disconnects via onDisconnect, which is unreliable on a clean
    // sign-out where the page stays open) and other peers continue
    // to render the user's chip as if they were still in the room.
    if (get().collab.session.id) {
      try {
        await get().leaveSession();
      } catch {
        // Best-effort — proceed with sign-out either way.
      }
    }
    // onIdTokenChanged fires with null right after; state transitions to
    // "anon" from there. No manual reset needed.
    await fbSignOut(auth);
  },
});
