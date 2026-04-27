import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import {
  CUSTOM_SAMPLE_MAX_ENCODED_BYTES,
  CUSTOM_SAMPLE_MIN_DURATION_MS,
  CUSTOM_SAMPLE_MAX_DURATION_MS,
  type SampleRef,
} from "@beats/shared";
import { db, rtdb, storage } from "../services/firebase-admin.js";
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
        projectId?: string;
        sessionId?: string;
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

      // If a projectId is supplied, the requester must be able to
      // write the project. Project owners + collaborators always pass.
      // Session participants ALSO pass — joining a session by link
      // gives you the same upload capability as a collaborator for
      // the duration of the jam, so invitees can drop loops into the
      // host's rig the same way real bands share a mixer board.
      if (body.projectId) {
        const projectSnap = await db
          .collection("projects")
          .doc(body.projectId)
          .get();
        if (!projectSnap.exists) {
          return next(NotFoundError("project not found"));
        }
        const project = projectSnap.data() as {
          ownerId: string;
          collaboratorIds?: string[];
        };
        let canEdit =
          project.ownerId === uid ||
          (Array.isArray(project.collaboratorIds) &&
            project.collaboratorIds.includes(uid));
        if (!canEdit && body.sessionId) {
          // Session-aware upload: same shape as the download-urls
          // session check. Participant + matching project + 24h TTL.
          const sessionSnap = await rtdb
            .ref(`sessions/${body.sessionId}`)
            .get();
          if (sessionSnap.exists()) {
            const session = sessionSnap.val() as {
              meta?: {
                projectId?: string;
                status?: string;
                createdAt?: number;
              };
              participants?: Record<string, unknown>;
            };
            const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
            const ageMs = session.meta?.createdAt
              ? Date.now() - session.meta.createdAt
              : Number.POSITIVE_INFINITY;
            if (
              session.meta?.status === "open" &&
              session.meta.projectId === body.projectId &&
              session.participants?.[uid] &&
              ageMs <= SESSION_MAX_AGE_MS
            ) {
              canEdit = true;
            }
          }
        }
        if (!canEdit) {
          return next(ForbiddenError("not a member of this project"));
        }
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
        ...(body.projectId ? { projectId: body.projectId } : {}),
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

      await ref.delete();
      // Refcount-aware blob delete. After fork, multiple sample docs
      // can point at the same storagePath (cloneSamplesForFork reuses
      // the blob to avoid storage duplication). Only delete the blob
      // when THIS doc was the last reference — otherwise the fork's
      // copies would suddenly 404 on the next download-url sign.
      const survivors = await db
        .collection("samples")
        .where("storagePath", "==", sample.storagePath)
        .limit(1)
        .get();
      if (survivors.empty) {
        await storage
          .bucket()
          .file(sample.storagePath)
          .delete()
          .catch(() => undefined);
      }
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
      const body = req.body as { ids: string[]; sessionId?: string };
      // Fetch all docs in parallel, then filter to ones the caller can
      // access. Built-ins are world-readable in storage.rules, so the
      // signed-URL path is for owned customs only — but we tolerate
      // mixed input and only sign for what's permitted.
      const refs = body.ids.map((id) => db.collection("samples").doc(id));
      const snaps = await db.getAll(...refs);

      // Build the set of project IDs the requester can read samples
      // for. (1) projects they own or collaborate on, (2) the project
      // attached to a live session they're a participant in. Cached
      // here so we only do the lookups once per request.
      const accessibleProjectIds = new Set<string>();
      // (1) project membership comes from the sample's projectId; we
      // check on demand below.
      // (2) Session participation — if a sessionId was passed, verify
      // the requester is a participant and stamp the session's project
      // as accessible. We also enforce a 24h max-age on the session:
      // RTDB onDisconnect cleans live state but doesn't flip
      // meta.status to "ended" if the host hard-killed their browser,
      // so a session that was never explicitly ended stays "open"
      // forever. A former participant could otherwise re-use a stale
      // sessionId months later to fetch sample URLs. The TTL closes
      // that authorization gap without needing a background sweeper.
      if (body.sessionId) {
        const sessionSnap = await rtdb.ref(`sessions/${body.sessionId}`).get();
        if (sessionSnap.exists()) {
          const session = sessionSnap.val() as {
            meta?: {
              projectId?: string;
              status?: string;
              createdAt?: number;
            };
            participants?: Record<string, unknown>;
          };
          const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
          const ageMs = session.meta?.createdAt
            ? Date.now() - session.meta.createdAt
            : Number.POSITIVE_INFINITY;
          if (
            session.meta?.status === "open" &&
            session.meta.projectId &&
            session.participants?.[uid] &&
            ageMs <= SESSION_MAX_AGE_MS
          ) {
            accessibleProjectIds.add(session.meta.projectId);
          }
        }
      }

      const projectMembershipCache = new Map<string, boolean>();
      const isProjectMember = async (projectId: string): Promise<boolean> => {
        if (accessibleProjectIds.has(projectId)) return true;
        const cached = projectMembershipCache.get(projectId);
        if (cached !== undefined) return cached;
        const projectSnap = await db
          .collection("projects")
          .doc(projectId)
          .get();
        if (!projectSnap.exists) {
          projectMembershipCache.set(projectId, false);
          return false;
        }
        const project = projectSnap.data() as {
          ownerId: string;
          collaboratorIds?: string[];
          isPublic?: boolean;
        };
        const member =
          project.ownerId === uid ||
          project.isPublic === true ||
          (Array.isArray(project.collaboratorIds) &&
            project.collaboratorIds.includes(uid));
        projectMembershipCache.set(projectId, member);
        return member;
      };

      const expires = Date.now() + 10 * 60 * 1000;
      const entries = await Promise.all(
        snaps.map(async (snap) => {
          if (!snap.exists) return null;
          const sample = snap.data() as SampleRef;
          if (sample.isBuiltIn) return null;
          let allowed = sample.ownerId === uid;
          if (!allowed && sample.projectId) {
            allowed = await isProjectMember(sample.projectId);
          }
          if (!allowed) return null;
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
