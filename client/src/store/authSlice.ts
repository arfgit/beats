import type { StateCreator } from "zustand";
import {
  signInWithPopup,
  signOut as fbSignOut,
  onIdTokenChanged,
  type User as FbUser,
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

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (
  set,
  get,
) => ({
  auth: { user: null, fbUser: null, status: "idle", errorMessage: null },

  bootAuth: () => {
    set((s) => ({ auth: { ...s.auth, status: "loading" } }));
    const unsub = onIdTokenChanged(auth, async (fbUser) => {
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
        const user = await api.post<User>("/auth/session");
        set({ auth: { user, fbUser, status: "authed", errorMessage: null } });
      } catch (err) {
        const message =
          err instanceof ApiCallError ? err.apiError.message : "session error";
        set({
          auth: { user: null, fbUser, status: "error", errorMessage: message },
        });
      }
    });
    return unsub;
  },

  signInWithGoogle: async () => {
    set((s) => ({
      auth: { ...s.auth, status: "loading", errorMessage: null },
    }));
    try {
      await signInWithPopup(auth, googleProvider);
      // onIdTokenChanged handles the rest
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign-in failed";
      set((s) => ({
        auth: { ...s.auth, status: "error", errorMessage: message },
      }));
    }
  },

  signOut: async () => {
    await fbSignOut(auth);
    // TODO: reset audio engine + clear project slice on Phase 2b integration
    void get;
  },
});
