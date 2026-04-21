import { Router, type NextFunction, type Response } from "express";
import type { User } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { updateUserBody } from "../lib/schemas.js";

const router = Router();

router.get(
  "/users/:uid",
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db.collection("users").doc(req.params.uid!).get();
      if (!snap.exists) return next(NotFoundError("user not found"));
      const user = snap.data() as User;
      // Strip email for non-self public reads
      const { email, ...publicFields } = user;
      void email;
      res.json({ data: publicFields });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/users/me",
  requireAuth,
  validateBody(updateUserBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("users").doc(req.auth!.uid);
      const updates = req.body as Partial<User>;
      await ref.update(updates);
      const snap = await ref.get();
      res.json({ data: snap.data() });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
