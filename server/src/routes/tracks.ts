import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import type { UploadedTrack } from "@beats/shared";
import { db, storage } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
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
      const EXT_MAP: Record<string, string> = {
        "audio/wav": "wav",
        "audio/mpeg": "mp3",
        "audio/webm": "webm",
        "audio/mp4": "mp4",
      };
      const extension = EXT_MAP[body.contentType];
      if (!extension) {
        return next(
          ValidationError(`unsupported content type: ${body.contentType}`),
        );
      }
      const id = nanoid(14);
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

      // extensionHeaders binds Content-Type into the signature so GCS
      // rejects the PUT if the actual request header doesn't match.
      const [signedUrl] = await storage
        .bucket()
        .file(storagePath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          contentType: body.contentType,
          extensionHeaders: { "content-type": body.contentType },
        });

      // Do not leak storagePath — client only needs trackId for finalize,
      // and uploadUrl for the upload itself.
      res.status(201).json({ data: { trackId: id, uploadUrl: signedUrl } });
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

      const file = storage.bucket().file(track.storagePath);
      const [exists] = await file.exists();
      if (!exists) return next(NotFoundError("upload did not land in storage"));

      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      const contentType = String(metadata.contentType ?? "");

      // 2 min stereo 48k 16-bit PCM WAV ≈ 23 MB; cap with headroom
      const MAX_BYTES = 32 * 1024 * 1024;
      if (size > MAX_BYTES) {
        await file.delete().catch(() => undefined);
        await ref.delete();
        return next(ValidationError(`upload exceeds ${MAX_BYTES} bytes`));
      }

      const ALLOWED = ["audio/wav", "audio/mpeg", "audio/webm", "audio/mp4"];
      if (!ALLOWED.some((t) => contentType.startsWith(t))) {
        await file.delete().catch(() => undefined);
        await ref.delete();
        return next(
          ValidationError(`unsupported content type: ${contentType}`),
        );
      }

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
