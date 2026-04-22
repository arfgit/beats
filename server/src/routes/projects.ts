import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import type { Project } from "@beats/shared";
import { isProjectMatrix } from "@beats/shared";
import { db } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import {
  createProjectBody,
  inviteBody,
  updateProjectBody,
} from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const writeLimiter = createRateLimiter({ capacity: 60, refillPerMin: 60 });

router.post(
  "/projects",
  requireAuth,
  writeLimiter,
  validateBody(createProjectBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const { title, pattern, isPublic } = req.body as ReturnType<
        typeof createProjectBody.parse
      >;
      const id = nanoid(14);
      const now = Date.now();
      const project: Project = {
        id,
        ownerId: uid,
        title,
        pattern,
        isPublic,
        collaboratorIds: [],
        updatedAt: now,
        revision: 1,
        createdAt: now,
      };
      await db.collection("projects").doc(id).set(project);
      res.status(201).json({ data: project });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/projects/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const snap = await db.collection("projects").doc(req.params.id!).get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const project = snap.data() as Project;
      if (!canRead(project, req.auth!.uid)) return next(ForbiddenError());
      res.json({ data: project });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/projects/:id",
  requireAuth,
  writeLimiter,
  validateBody(updateProjectBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("projects").doc(req.params.id!);
      const ifMatch = req.header("if-match");
      if (!ifMatch || !/^\d+$/.test(ifMatch)) {
        return next(
          ValidationError("If-Match header with numeric revision is required"),
        );
      }

      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw NotFoundError("project not found");
        const project = snap.data() as Project;
        if (!canEdit(project, req.auth!.uid)) throw ForbiddenError();

        if (Number(ifMatch) !== project.revision) {
          throw ConflictError(
            `revision mismatch (have ${project.revision}, got ${ifMatch})`,
          );
        }

        // Explicit allowlist — never spread req.body into the doc. Zod
        // already strips unknown keys, but this makes server-managed
        // fields (id, ownerId, createdAt, revision, collaboratorIds)
        // impossible to touch via PATCH regardless of schema drift.
        const body = req.body as {
          title?: string;
          pattern?: Project["pattern"]; // ProjectPattern: Pattern | ProjectMatrix
          isPublic?: boolean;
        };
        const isOwner = project.ownerId === req.auth!.uid;

        const safeUpdates: Partial<Project> = {};
        if (body.pattern !== undefined) {
          // Schema-downgrade guard: once a project has been migrated to
          // v2 (ProjectMatrix), a v1 client cannot overwrite it with a
          // legacy Pattern. Without this check a stale client could clobber
          // matrix state with flat pattern state on every save, and the
          // revision field alone wouldn't catch it (it just tracks
          // concurrent writes, not schema intent). Tell the client to
          // refresh rather than silently accepting.
          if (
            isProjectMatrix(project.pattern) &&
            !isProjectMatrix(body.pattern)
          ) {
            throw ConflictError(
              "this project uses the matrix schema — reload to get the latest client",
            );
          }
          safeUpdates.pattern = body.pattern;
        }
        if (isOwner && body.title !== undefined) safeUpdates.title = body.title;
        if (isOwner && body.isPublic !== undefined)
          safeUpdates.isPublic = body.isPublic;

        const updated: Project = {
          ...project,
          ...safeUpdates,
          revision: project.revision + 1,
          updatedAt: Date.now(),
        };
        tx.set(ref, updated);
        return updated;
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/projects/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("projects").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const project = snap.data() as Project;
      if (project.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));
      await ref.delete();
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/projects/:id/fork",
  requireAuth,
  writeLimiter,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const origRef = db.collection("projects").doc(req.params.id!);
      const snap = await origRef.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const original = snap.data() as Project;
      if (!canRead(original, req.auth!.uid)) return next(ForbiddenError());

      const newId = nanoid(14);
      const now = Date.now();
      const fork: Project = {
        ...original,
        id: newId,
        ownerId: req.auth!.uid,
        title: `${original.title} (fork)`,
        isPublic: false,
        collaboratorIds: [],
        revision: 1,
        updatedAt: now,
        createdAt: now,
      };
      await db.collection("projects").doc(newId).set(fork);
      res.status(201).json({ data: fork });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/projects/:id/collaborators",
  requireAuth,
  writeLimiter,
  validateBody(inviteBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body as { email: string };
      const ref = db.collection("projects").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const project = snap.data() as Project;
      if (project.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));

      const userSnap = await db
        .collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();
      if (userSnap.empty) return next(NotFoundError("no user with that email"));
      const inviteeId = userSnap.docs[0]!.id;
      if (project.collaboratorIds.includes(inviteeId)) {
        return res.json({ data: project });
      }

      const updated: Project = {
        ...project,
        collaboratorIds: [...project.collaboratorIds, inviteeId],
        revision: project.revision + 1,
        updatedAt: Date.now(),
      };
      await ref.set(updated);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/projects/:id/collaborators/:uid",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("projects").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const project = snap.data() as Project;
      if (project.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));

      const updated: Project = {
        ...project,
        collaboratorIds: project.collaboratorIds.filter(
          (u) => u !== req.params.uid,
        ),
        revision: project.revision + 1,
        updatedAt: Date.now(),
      };
      await ref.set(updated);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

function canRead(project: Project, uid: string): boolean {
  return (
    project.ownerId === uid ||
    project.isPublic ||
    project.collaboratorIds.includes(uid)
  );
}

function canEdit(project: Project, uid: string): boolean {
  return project.ownerId === uid || project.collaboratorIds.includes(uid);
}

export default router;
