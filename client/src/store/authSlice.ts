import type { StateCreator } from "zustand";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type AuthError,
  type User as FbUser,
} from "firebase/auth";
import type { User } from "@beats/shared";
import { auth, googleProvider } from "@/lib/firebase";
import { api, ApiCallError } from "@/lib/api";
import type { BeatsStore } from "./useBeatsStore";

export type AuthStatus =
  | "idle"
  | "loading"
  | "authed"
  | "anon"
  | "error"
  | "needsUsername";

export interface AuthSlice {
  auth: {
    user: User | null;
    fbUser: FbUser | null;
    status: AuthStatus;
    errorMessage: string | null;
  };
  bootAuth: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  claimUsername: (username: string) => Promise<void>;
  refreshSession: () => Promise<void>;
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

/**
 * Map a User doc to the auth status. Empty `username` means the doc
 * exists but the public handle hasn't been claimed yet — the AppShell
 * renders the UsernameOnboarding takeover until claimUsername runs.
 */
function statusFromUser(user: User): "authed" | "needsUsername" {
  return user.username ? "authed" : "needsUsername";
}

export const createAuthSlice: StateCreator<BeatsStore, [], [], AuthSlice> = (
  set,
  get,
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
            auth: {
              user,
              fbUser,
              status: statusFromUser(user),
              errorMessage: null,
            },
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

  signInWithPassword: async (email, password) => {
    set((s) => ({
      auth: { ...s.auth, status: "loading", errorMessage: null },
    }));
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onIdTokenChanged drives the rest — bootAuth's listener picks up
      // the new credential and POSTs /auth/session.
    } catch (err) {
      const code = isAuthError(err) ? err.code : "";
      set((s) => ({
        auth: {
          ...s.auth,
          status: "error",
          errorMessage: passwordSignInMessage(code, err),
        },
      }));
    }
  },

  signUpWithPassword: async (email, password) => {
    set((s) => ({
      auth: { ...s.auth, status: "loading", errorMessage: null },
    }));
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Fire-and-forget verification — failure here shouldn't block sign-in,
      // and a "Resend" CTA in the profile UI gives the user a recovery path.
      void sendEmailVerification(cred.user).catch((err) => {
        console.warn("[auth] sendEmailVerification failed", err);
      });
      // onIdTokenChanged drives the rest. The server creates the User doc
      // with username="" and the listener flips status to "needsUsername".
    } catch (err) {
      const code = isAuthError(err) ? err.code : "";
      set((s) => ({
        auth: {
          ...s.auth,
          status: "error",
          errorMessage: passwordSignUpMessage(code, err),
        },
      }));
    }
  },

  sendPasswordReset: async (email) => {
    // Don't flip global status — this is an inline form action, the
    // caller surfaces success/failure locally.
    await sendPasswordResetEmail(auth, email);
  },

  resendVerificationEmail: async () => {
    const fbUser = get().auth.fbUser;
    if (!fbUser) throw new Error("not signed in");
    await sendEmailVerification(fbUser);
  },

  claimUsername: async (username) => {
    // Server is the source of truth; client validates inline for UX
    // but the 409 / 400 path is the only one that matters for state.
    const updated = await api.post<User>("/auth/claim-username", { username });
    set((s) => ({
      auth: {
        ...s.auth,
        user: updated,
        status: statusFromUser(updated),
        errorMessage: null,
      },
    }));
  },

  refreshSession: async () => {
    // Force a fresh ID token so emailVerified / authProviders pick up
    // any change that happened in another tab or via a verification link.
    const fbUser = get().auth.fbUser;
    if (!fbUser) return;
    await fbUser.reload();
    const idToken = await fbUser.getIdToken(true);
    const user = await api.post<User>("/auth/session", undefined, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    set((s) => ({
      auth: {
        ...s.auth,
        user,
        status: statusFromUser(user),
        errorMessage: null,
      },
    }));
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

// Friendly Firebase Auth error mapping. Firebase's default messages
// like "FirebaseError: Firebase: Error (auth/wrong-password)." are
// useless to non-technical users; we narrow to the codes we expect
// from each flow and translate to UI copy.
function passwordSignInMessage(code: string, err: unknown): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "incorrect email or password";
    case "auth/too-many-requests":
      return "too many attempts — try again in a minute";
    case "auth/user-disabled":
      return "this account has been disabled";
    case "auth/invalid-email":
      return "that doesn't look like a valid email";
    case "auth/network-request-failed":
      return "network error — check your connection";
    default:
      return err instanceof Error ? err.message : "sign-in failed";
  }
}

function passwordSignUpMessage(code: string, err: unknown): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "an account already exists for that email";
    case "auth/weak-password":
      return "password must be at least 6 characters";
    case "auth/invalid-email":
      return "that doesn't look like a valid email";
    case "auth/network-request-failed":
      return "network error — check your connection";
    default:
      return err instanceof Error ? err.message : "sign-up failed";
  }
}
