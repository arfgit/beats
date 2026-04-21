import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import type { Project, User } from "@beats/shared";
import { adminAuth, db } from "../services/firebase-admin.js";
import { requireAdmin, requireAuth, type AuthedRequest } from "../lib/auth.js";
import { NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";

const router = Router();

router.get(
  "/admin/users",
  requireAuth,
  requireAdmin,
  async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db.collection("users").limit(100).get();
      const users = snap.docs.map((d) => d.data() as User);
      res.json({ data: users });
    } catch (err) {
      next(err);
    }
  },
);

const updateUserRole = z.object({
  role: z.enum(["user", "admin"]).optional(),
  disabled: z.boolean().optional(),
});

router.patch(
  "/admin/users/:uid",
  requireAuth,
  requireAdmin,
  validateBody(updateUserRole),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { role?: "user" | "admin"; disabled?: boolean };
      const uid = req.params.uid!;
      if (body.role) {
        await adminAuth.setCustomUserClaims(uid, { role: body.role });
        await db.collection("users").doc(uid).update({ role: body.role });
      }
      if (typeof body.disabled === "boolean") {
        await adminAuth.updateUser(uid, { disabled: body.disabled });
      }
      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return next(NotFoundError("user not found"));
      res.json({ data: snap.data() });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/admin/projects/:id",
  requireAuth,
  requireAdmin,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("projects").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      await ref.delete();
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/admin/projects",
  requireAuth,
  requireAdmin,
  async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db
        .collection("projects")
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get();
      const projects = snap.docs.map((d) => d.data() as Project);
      res.json({ data: projects });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
