import { Router, type Response, type NextFunction } from "express";
import type { User } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError } from "../lib/errors.js";

const router = Router();

router.post(
  "/auth/session",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid, email } = req.auth!;
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        const newUser: User = {
          id: uid,
          displayName: email?.split("@")[0] ?? "user",
          email: email ?? "",
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

      res.json({ data: snap.data() });
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
