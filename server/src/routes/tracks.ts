import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import type { UploadedTrack } from "@beats/shared";
import { db, storage } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { finalizeTrackBody, uploadUrlBody } from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const uploadLimiter = createRateLimiter({ capacity: 10, refillPerMin: 20 });

router.post(
  "/tracks/upload-url",
  requireAuth,
  uploadLimiter,
  validateBody(uploadUrlBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const body = req.body as {
        title: string;
        durationMs: number;
        projectId?: string | null;
        contentType: string;
      };
      const id = nanoid(14);
      const extension =
        body.contentType === "audio/wav"
          ? "wav"
          : body.contentType === "audio/mpeg"
            ? "mp3"
            : "webm";
      const storagePath = `tracks/${uid}/${id}.${extension}`;

      const pending: UploadedTrack & { status: "pending" | "ready" } = {
        id,
        ownerId: uid,
        projectId: body.projectId ?? null,
        title: body.title,
        storagePath,
        durationMs: body.durationMs,
        createdAt: Date.now(),
        status: "pending",
      };
      await db.collection("uploadedTracks").doc(id).set(pending);

      const [signedUrl] = await storage
        .bucket()
        .file(storagePath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 min
          contentType: body.contentType,
        });

      res
        .status(201)
        .json({ data: { trackId: id, storagePath, uploadUrl: signedUrl } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/tracks/:id/finalize",
  requireAuth,
  uploadLimiter,
  validateBody(finalizeTrackBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("uploadedTracks").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("track not found"));
      const track = snap.data() as UploadedTrack & { status: string };
      if (track.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));

      const [exists] = await storage.bucket().file(track.storagePath).exists();
      if (!exists) return next(NotFoundError("upload did not land in storage"));

      const updated: UploadedTrack & { status: "ready" } = {
        ...track,
        status: "ready",
        createdAt: track.createdAt,
      };
      await ref.update({ status: "ready" });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/tracks/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const ref = db.collection("uploadedTracks").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("track not found"));
      const track = snap.data() as UploadedTrack;
      if (track.ownerId !== req.auth!.uid)
        return next(ForbiddenError("owner only"));

      await Promise.all([
        storage
          .bucket()
          .file(track.storagePath)
          .delete()
          .catch(() => undefined),
        ref.delete(),
      ]);
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
