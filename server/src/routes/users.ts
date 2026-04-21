import { Router, type NextFunction, type Response } from "express";
import type { User } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { updateUserBody } from "../lib/schemas.js";

const router = Router();

/**
 * Public profile read — auth required. For private profiles we only
 * return the minimum identity fields so the viewer can't enumerate
 * email / bio / social links / role.
 */
router.get(
  "/users/:uid",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db.collection("users").doc(req.params.uid!).get();
      if (!snap.exists) return next(NotFoundError("user not found"));
      const user = snap.data() as User;
      const isSelf = user.id === req.auth!.uid;

      if (isSelf) {
        res.json({ data: user });
        return;
      }

      if (user.isPublic) {
        res.json({
          data: {
            id: user.id,
            displayName: user.displayName,
            photoUrl: user.photoUrl,
            bio: user.bio,
            socialLinks: user.socialLinks,
            isPublic: true,
            createdAt: user.createdAt,
          },
        });
        return;
      }

      // Private profile — minimal identity only
      res.json({
        data: {
          id: user.id,
          displayName: user.displayName,
          photoUrl: user.photoUrl,
          isPublic: false,
        },
      });
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
