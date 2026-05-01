import { Router, type NextFunction, type Response } from "express";
import type { User } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { updateUserBody } from "../lib/schemas.js";
import { lookupUsername } from "../services/username-service.js";

const router = Router();

/**
 * Project a User document into the cross-user response shape. Strips
 * email, role, authProviders, emailVerified — those are auth metadata
 * that nobody but the owner needs. Username is included because it's
 * the public handle by definition.
 */
function projectUserForViewer(user: User, isSelf: boolean): Partial<User> {
  if (isSelf) return user;
  if (user.isPublic) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      bio: user.bio,
      socialLinks: user.socialLinks,
      isPublic: true,
      createdAt: user.createdAt,
    };
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    isPublic: false,
  };
}

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
      res.json({ data: projectUserForViewer(user, isSelf) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Public profile lookup by username — same projection as /users/:uid
 * but keyed on the canonical handle. Two-hop read: usernames/{lower}
 * → uid → users/{uid}.
 */
router.get(
  "/users/by-username/:handle",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const handle = req.params.handle ?? "";
      const uid = await lookupUsername(handle);
      if (!uid) return next(NotFoundError("user not found"));
      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return next(NotFoundError("user not found"));
      const user = snap.data() as User;
      const isSelf = user.id === req.auth!.uid;
      res.json({ data: projectUserForViewer(user, isSelf) });
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
