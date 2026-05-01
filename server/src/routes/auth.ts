import { Router, type Response, type NextFunction } from "express";
import type { AuthProvider, User } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";

const router = Router();

function providerFromToken(signInProvider: string | undefined): AuthProvider {
  // Firebase Auth's sign_in_provider claim — currently we accept Google
  // and Email/Password. Phone is on the v1.1 backlog and would require
  // a corresponding User shape change (nullable email).
  if (signInProvider === "google.com") return "google.com";
  if (signInProvider === "password") return "password";
  // Default to "password" rather than throwing so a future provider rolled
  // into Firebase Auth doesn't 500 the session endpoint; the user can still
  // claim a username and use the app while we add explicit support.
  return "password";
}

router.post(
  "/auth/session",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid, email, emailVerified, signInProvider } = req.auth!;
      // v1 invariant: every supported provider issues an email. Phone
      // is deferred — when it lands, this guard moves into a per-provider
      // branch that allows email=null only for sign_in_provider=phone.
      if (!email) {
        return next(
          ValidationError(
            "auth token missing email — provider not supported in v1",
          ),
        );
      }
      const provider = providerFromToken(signInProvider);
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        const newUser: User = {
          id: uid,
          schemaVersion: 2,
          // Username starts empty — client maps to status "needsUsername"
          // and renders the onboarding takeover until claimUsername runs.
          username: "",
          usernameLower: "",
          displayName: email.split("@")[0] ?? "user",
          email,
          emailVerified: !!emailVerified,
          authProviders: [provider],
          photoUrl: null,
          bio: "",
          socialLinks: [],
          role: "user",
          isPublic: false,
          createdAt: Date.now(),
        };
        // Use create() — atomic insert that fails if the doc already
        // exists. Two simultaneous first-login requests would otherwise
        // race (both see !exists, both blind-set).
        try {
          await userRef.create(newUser);
          res.json({ data: newUser });
          return;
        } catch (err) {
          const code = (err as { code?: number | string }).code;
          // 6 = ALREADY_EXISTS in Firestore gRPC status codes
          if (code !== 6 && code !== "already-exists") throw err;
          const raced = await userRef.get();
          res.json({ data: raced.data() });
          return;
        }
      }

      // Existing user — refresh emailVerified + authProviders if drift.
      // Don't backfill `false` for legacy docs that lack the field; only
      // write when we have a positive signal from the current token.
      const existing = snap.data() as Partial<User>;
      const updates: Record<string, unknown> = {};
      if (typeof emailVerified === "boolean") {
        if (existing.emailVerified !== emailVerified) {
          updates.emailVerified = emailVerified;
        }
      }
      const providers = existing.authProviders ?? [];
      if (!providers.includes(provider)) {
        updates.authProviders = [...providers, provider];
      }
      if (Object.keys(updates).length > 0) {
        await userRef.update(updates);
      }

      const refreshed = Object.keys(updates).length
        ? (await userRef.get()).data()
        : snap.data();
      res.json({ data: refreshed });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/auth/me",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db.collection("users").doc(req.auth!.uid).get();
      if (!snap.exists) return next(NotFoundError("user not found"));
      res.json({ data: snap.data() });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/auth/signout", requireAuth, (_req, res) => {
  res.json({ data: { ok: true } });
});

export default router;
