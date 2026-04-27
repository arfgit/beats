import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import type { Project, ProjectMatrix, SampleRef } from "@beats/shared";
import { isProjectMatrix } from "@beats/shared";
import { db, storage } from "../services/firebase-admin.js";
import { releaseQuotaSlot } from "../services/samples-service.js";
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
      const projectId = req.params.id!;
      const ref = db.collection("projects").doc(projectId);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("project not found"));
      const project = snap.data() as Project;
      if (project.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));
      // Cascade: delete every sample doc rigged to this project so we
      // don't leave orphans in Firestore (they'd otherwise consume
      // quota forever and never be reachable through the picker).
      // Refcount-aware blob delete: only nuke the storage object when
      // no remaining sample doc references it (fork copies share the
      // path with the original to avoid storage duplication).
      const sampleSnap = await db
        .collection("samples")
        .where("projectId", "==", projectId)
        .get();
      const cascadePaths: string[] = [];
      const cascadeIds: string[] = [];
      const releaseTasks: Array<{ uid: string; size: number }> = [];
      // Collect first so the survivor query below sees the
      // post-delete state.
      const batch = db.batch();
      for (const doc of sampleSnap.docs) {
        const sample = doc.data() as SampleRef & {
          originalSizeBytes?: number;
        };
        if (sample.isBuiltIn) continue;
        cascadeIds.push(doc.id);
        cascadePaths.push(sample.storagePath);
        if (sample.ownerId) {
          releaseTasks.push({
            uid: sample.ownerId,
            size: sample.originalSizeBytes ?? 0,
          });
        }
        batch.delete(doc.ref);
      }
      batch.delete(ref);
      await batch.commit();

      // Best-effort cleanup of orphan blobs + quota slots. We don't
      // fail the request if these falter — the doc cascade is the
      // important contract; storage GC is an optimization.
      const uniquePaths = Array.from(new Set(cascadePaths));
      await Promise.all(
        uniquePaths.map(async (path) => {
          const survivors = await db
            .collection("samples")
            .where("storagePath", "==", path)
            .limit(1)
            .get();
          if (survivors.empty) {
            await storage
              .bucket()
              .file(path)
              .delete()
              .catch(() => undefined);
          }
        }),
      );
      await Promise.all(
        releaseTasks.map((task) =>
          releaseQuotaSlot(task.uid, task.size).catch(() => undefined),
        ),
      );
      void cascadeIds; // future telemetry hook
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
      // Clone the source project's sample rig into the fork so the
      // forker can hear every sample the original project used —
      // without this, custom samples would silently fail to load
      // because the fork's owner doesn't have read access to the
      // original samples.
      const sampleRewrite = await cloneSamplesForFork(
        original.id,
        newId,
        req.auth!.uid,
      );
      const forkPattern = isProjectMatrix(original.pattern)
        ? rewriteMatrixSampleIds(original.pattern, sampleRewrite)
        : rewriteFlatPatternSampleIds(original.pattern, sampleRewrite);
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
        pattern: forkPattern,
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

/**
 * Clone every sample doc whose projectId matches `srcProjectId` into
 * doc copies that point at the SAME storage path but are stamped with
 * `dstProjectId` + `dstOwnerId`. Returns a sampleId rewrite map so the
 * caller can walk the destination project's matrix and update track
 * + step references.
 *
 * Storage files are NOT duplicated — multiple sample docs sharing one
 * storagePath is fine because reads go through the signed-URL path,
 * which signs from the doc, not the path.
 */
export async function cloneSamplesForFork(
  srcProjectId: string,
  dstProjectId: string,
  dstOwnerId: string,
): Promise<Record<string, SampleRef>> {
  const snap = await db
    .collection("samples")
    .where("projectId", "==", srcProjectId)
    .get();
  if (snap.empty) return {};
  // Map from original sample id to the FULL cloned SampleRef. We
  // need the full ref because each step + track snapshots
  // (sampleId, sampleVersion, sampleName) at toggle time — leaving
  // the version + name fields pointing at the source doc produces
  // wrong-version playback or label drift after the fork.
  const rewrite: Record<string, SampleRef> = {};
  const batch = db.batch();
  for (const doc of snap.docs) {
    const original = doc.data() as SampleRef & { status?: string };
    // Skip pending uploads — only finalized samples are part of the rig.
    // Accepted edge case: if the source matrix activated a step on a
    // sample that finalized after the fork was taken, the fork retains
    // an orphan reference until the user re-uploads.
    if (original.status === "pending") continue;
    const newId = nanoid(14);
    const cloned: SampleRef & { status?: string } = {
      ...original,
      id: newId,
      ownerId: dstOwnerId,
      projectId: dstProjectId,
      createdAt: Date.now(),
      status: "ready",
    };
    rewrite[original.id] = cloned;
    batch.set(db.collection("samples").doc(newId), cloned);
  }
  await batch.commit();
  return rewrite;
}

/**
 * Walk a v2 ProjectMatrix and rewrite every sample reference (track
 * AND step) — id, version, AND display name — using the cloned doc
 * metadata. Returns a new matrix; does not mutate the input.
 * Unmapped ids pass through unchanged so built-in samples and any
 * cross-project orphans stay as they are.
 */
export function rewriteMatrixSampleIds(
  matrix: ProjectMatrix,
  rewrite: Record<string, SampleRef>,
): ProjectMatrix {
  if (Object.keys(rewrite).length === 0) return matrix;
  return {
    ...matrix,
    cells: matrix.cells.map((cell) => ({
      ...cell,
      pattern: {
        ...cell.pattern,
        tracks: cell.pattern.tracks.map((track) => {
          const cloned = track.sampleId ? rewrite[track.sampleId] : null;
          const nextTrack = cloned
            ? {
                ...track,
                sampleId: cloned.id,
                sampleVersion: cloned.version,
                sampleName: cloned.name,
              }
            : track;
          return {
            ...nextTrack,
            steps: nextTrack.steps.map((step) => {
              if (!step.sampleId) return step;
              const stepCloned = rewrite[step.sampleId];
              if (!stepCloned) return step;
              return {
                ...step,
                sampleId: stepCloned.id,
                sampleVersion: stepCloned.version,
                sampleName: stepCloned.name,
              };
            }),
          };
        }),
      },
    })),
  };
}

/**
 * v1 (flat) Pattern variant of the rewrite. Without this, forking a
 * legacy v1 project would call cloneSamplesForFork (writing new
 * sample docs) but never rewrite the pattern — orphaning every clone
 * because the fork's tracks still reference the source ids.
 */
export function rewriteFlatPatternSampleIds<
  P extends { tracks: import("@beats/shared").Track[] },
>(pattern: P, rewrite: Record<string, SampleRef>): P {
  if (Object.keys(rewrite).length === 0) return pattern;
  return {
    ...pattern,
    tracks: pattern.tracks.map((track) => {
      const cloned = track.sampleId ? rewrite[track.sampleId] : null;
      const nextTrack = cloned
        ? {
            ...track,
            sampleId: cloned.id,
            sampleVersion: cloned.version,
            sampleName: cloned.name,
          }
        : track;
      return {
        ...nextTrack,
        steps: nextTrack.steps.map((step) => {
          if (!step.sampleId) return step;
          const stepCloned = rewrite[step.sampleId];
          if (!stepCloned) return step;
          return {
            ...step,
            sampleId: stepCloned.id,
            sampleVersion: stepCloned.version,
            sampleName: stepCloned.name,
          };
        }),
      };
    }),
  };
}

export default router;
