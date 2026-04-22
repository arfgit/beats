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
      // Explicit allowlist — never spread req.body into a Firestore write,
      // even through a Zod-validated alias. Keeps server-managed fields
      // (id, email, role, createdAt) protected regardless of schema drift.
      const body = req.body as {
        displayName?: string;
        bio?: string;
        socialLinks?: { kind: string; url: string }[];
        photoUrl?: string | null;
        isPublic?: boolean;
      };
      const safeUpdate: Record<string, unknown> = {};
      if (body.displayName !== undefined)
        safeUpdate.displayName = body.displayName;
      if (body.bio !== undefined) safeUpdate.bio = body.bio;
      if (body.socialLinks !== undefined)
        safeUpdate.socialLinks = body.socialLinks;
      if (body.photoUrl !== undefined) safeUpdate.photoUrl = body.photoUrl;
      if (body.isPublic !== undefined) safeUpdate.isPublic = body.isPublic;

      const ref = db.collection("users").doc(req.auth!.uid);
      await ref.update(safeUpdate);
      const snap = await ref.get();
      res.json({ data: snap.data() });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
