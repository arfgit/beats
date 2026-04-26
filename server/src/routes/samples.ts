import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import {
  CUSTOM_SAMPLE_MAX_ENCODED_BYTES,
  CUSTOM_SAMPLE_MIN_DURATION_MS,
  CUSTOM_SAMPLE_MAX_DURATION_MS,
  type SampleRef,
} from "@beats/shared";
import { db, storage } from "../services/firebase-admin.js";
import {
  reserveQuotaSlot,
  releaseQuotaSlot,
  recordFinalizedBytes,
} from "../services/samples-service.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import {
  sampleDownloadUrlsBody,
  sampleFinalizeBody,
  sampleUploadUrlBody,
} from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const uploadLimiter = createRateLimiter({ capacity: 5, refillPerMin: 10 });
const downloadLimiter = createRateLimiter({ capacity: 60, refillPerMin: 60 });

// Sanitize a user-supplied filename for display. Storage path is server-
// generated, so this is purely cosmetic — but we still strip control
// chars + cap length to keep it safe in tooltips and Firestore queries.
function sanitizeSourceFileName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
      .slice(0, 200) || undefined
  );
}

router.post(
  "/samples/upload-url",
  requireAuth,
  uploadLimiter,
  validateBody(sampleUploadUrlBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const body = req.body as {
        name: string;
        durationMs: number;
        sourceFileName?: string;
      };

      // Defense in depth — Zod already enforces this, but the constants
      // are the source of truth and may diverge in the future.
      if (
        body.durationMs < CUSTOM_SAMPLE_MIN_DURATION_MS ||
        body.durationMs > CUSTOM_SAMPLE_MAX_DURATION_MS
      ) {
        return next(
          ValidationError(
            `durationMs must be in [${CUSTOM_SAMPLE_MIN_DURATION_MS}, ${CUSTOM_SAMPLE_MAX_DURATION_MS}]`,
          ),
        );
      }

      try {
        await reserveQuotaSlot(uid);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "QUOTA_EXCEEDED") {
          return next(ConflictError("custom sample limit reached"));
        }
        throw err;
      }

      const id = nanoid(14);
      const storagePath = `samples/users/${uid}/${id}.wav`;
      const contentType = "audio/wav";

      const pending: SampleRef & { status: "pending" } = {
        id,
        kind: "custom",
        name: body.name.trim().slice(0, 120),
        storagePath,
        version: 1,
        durationMs: body.durationMs,
        isBuiltIn: false,
        ownerId: uid,
        createdAt: Date.now(),
        sourceFileName: sanitizeSourceFileName(body.sourceFileName),
        status: "pending",
      };
      await db.collection("samples").doc(id).set(pending);

      const [signedUrl] = await storage
        .bucket()
        .file(storagePath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          contentType,
          extensionHeaders: { "content-type": contentType },
        });

      res
        .status(201)
        .json({ data: { sampleId: id, uploadUrl: signedUrl, contentType } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/samples/:id/finalize",
  requireAuth,
  uploadLimiter,
  validateBody(sampleFinalizeBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const ref = db.collection("samples").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("sample not found"));
      const sample = snap.data() as SampleRef & { status?: string };
      if (sample.ownerId !== uid) return next(ForbiddenError("owner only"));

      const file = storage.bucket().file(sample.storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        // Upload never landed — release the reserved slot so the user
        // isn't billed against their quota for an empty doc.
        await ref.delete().catch(() => undefined);
        await releaseQuotaSlot(uid).catch(() => undefined);
        return next(NotFoundError("upload did not land in storage"));
      }

      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      const contentType = String(metadata.contentType ?? "");

      if (size > CUSTOM_SAMPLE_MAX_ENCODED_BYTES) {
        await file.delete().catch(() => undefined);
        await ref.delete().catch(() => undefined);
        await releaseQuotaSlot(uid).catch(() => undefined);
        return next(
          ValidationError(
            `upload exceeds ${CUSTOM_SAMPLE_MAX_ENCODED_BYTES} bytes`,
          ),
        );
      }

      if (!contentType.startsWith("audio/wav")) {
        await file.delete().catch(() => undefined);
        await ref.delete().catch(() => undefined);
        await releaseQuotaSlot(uid).catch(() => undefined);
        return next(
          ValidationError(`unsupported content type: ${contentType}`),
        );
      }

      const finalized: SampleRef = {
        ...sample,
        originalSizeBytes: size,
      };
      // Drop the `status` discriminator now that the doc is "ready" —
      // SampleRef readers don't care, and absence is the canonical
      // ready state (mirrors the built-in samples shape).
      const updates: Record<string, unknown> = {
        originalSizeBytes: size,
      };
      // Use FieldValue.delete() via dot-path? firestore-admin does not
      // support that in `update`; safer to set both fields explicitly.
      await ref.update({ ...updates, status: "ready" });
      await recordFinalizedBytes(uid, size);
      res.json({ data: { ...finalized, status: "ready" } });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/samples/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const ref = db.collection("samples").doc(req.params.id!);
      const snap = await ref.get();
      if (!snap.exists) return next(NotFoundError("sample not found"));
      const sample = snap.data() as SampleRef;
      if (sample.ownerId !== uid) return next(ForbiddenError("owner only"));
      if (sample.isBuiltIn) {
        return next(ForbiddenError("built-in samples cannot be deleted"));
      }

      await Promise.all([
        storage
          .bucket()
          .file(sample.storagePath)
          .delete()
          .catch(() => undefined),
        ref.delete(),
      ]);
      await releaseQuotaSlot(uid, sample.originalSizeBytes ?? 0).catch(
        () => undefined,
      );
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/samples/download-urls",
  requireAuth,
  downloadLimiter,
  validateBody(sampleDownloadUrlsBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const body = req.body as { ids: string[] };
      // Fetch all docs in parallel, then filter to ones the caller can
      // access. Built-ins are world-readable in storage.rules, so the
      // signed-URL path is for owned customs only — but we tolerate
      // mixed input and only sign for what's permitted, returning the
      // direct CDN URL for built-ins is out of scope here (clients use
      // getDownloadURL for those already).
      const refs = body.ids.map((id) => db.collection("samples").doc(id));
      const snaps = await db.getAll(...refs);

      const expires = Date.now() + 10 * 60 * 1000;
      const entries = await Promise.all(
        snaps.map(async (snap) => {
          if (!snap.exists) return null;
          const sample = snap.data() as SampleRef;
          if (sample.isBuiltIn) return null;
          if (sample.ownerId !== uid) return null;
          const [url] = await storage
            .bucket()
            .file(sample.storagePath)
            .getSignedUrl({ version: "v4", action: "read", expires });
          return [sample.id, url] as const;
        }),
      );

      const urls = Object.fromEntries(
        entries.filter((e): e is readonly [string, string] => e !== null),
      );
      res.json({ data: { urls, expiresAt: expires } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
