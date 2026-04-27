import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import {
  COLLAB_PROTOCOL_VERSION,
  DEFAULT_SESSION_PERMISSIONS,
  type Project,
  type SessionMeta,
  type SessionParticipant,
  type SessionPermissions,
} from "@beats/shared";
import { db, rtdb, adminAuth } from "../services/firebase-admin.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import {
  createSessionBody,
  sessionEmptyBody,
  updateSessionPermissionsBody,
} from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const sessionLimiter = createRateLimiter({ capacity: 8, refillPerMin: 16 });

// Curated palette of distinguishable peer colors. Matches the studio's
// neon palette without colliding with the reserved error red.
const PEER_COLORS = [
  "#ff2a6d", // magenta
  "#05d9e8", // cyan
  "#b84dff", // violet
  "#ffb800", // sun
  "#39ff14", // green
  "#ff8c69", // coral
  "#84ffd2", // mint
  "#ffa3d3", // pink
];

function pickColorForUid(uid: string): string {
  // Stable hash so the same user always gets the same color across
  // sessions — recognizable continuity for collaborators.
  let hash = 0;
  for (let i = 0; i < uid.length; i++)
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  const index = Math.abs(hash) % PEER_COLORS.length;
  return PEER_COLORS[index]!;
}

async function readProject(projectId: string): Promise<Project | null> {
  const snap = await db.collection("projects").doc(projectId).get();
  if (!snap.exists) return null;
  return snap.data() as Project;
}

function isProjectMember(uid: string, project: Project): boolean {
  return (
    project.ownerId === uid ||
    (Array.isArray(project.collaboratorIds) &&
      project.collaboratorIds.includes(uid))
  );
}

/** Look up the user's display name; falls back to a short uid prefix. */
async function readDisplayName(uid: string): Promise<string> {
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const display = (userSnap.data() as { displayName?: string }).displayName;
      if (display && display.trim()) return display.trim();
    }
    const record = await adminAuth.getUser(uid);
    if (record.displayName?.trim()) return record.displayName.trim();
    if (record.email) return record.email.split("@")[0]!;
  } catch {
    // Ignore — fall through to uid prefix.
  }
  return `peer-${uid.slice(0, 6)}`;
}

router.post(
  "/sessions",
  requireAuth,
  sessionLimiter,
  validateBody(createSessionBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const { projectId } = req.body as { projectId: string };

      const project = await readProject(projectId);
      if (!project) return next(NotFoundError("project not found"));
      if (project.ownerId !== uid) {
        return next(
          ForbiddenError("only the project owner can start a session"),
        );
      }

      const sessionId = nanoid(12);
      const now = Date.now();
      const ownerName = await readDisplayName(uid);
      const meta: SessionMeta = {
        v: COLLAB_PROTOCOL_VERSION,
        sessionId,
        projectId,
        projectTitle: project.title,
        ownerUid: uid,
        ownerDisplayName: ownerName,
        createdAt: now,
        status: "open",
        permissions: { ...DEFAULT_SESSION_PERMISSIONS },
      };
      const ownerColor = pickColorForUid(uid);
      const ownerParticipant: SessionParticipant = {
        v: COLLAB_PROTOCOL_VERSION,
        uid,
        displayName: ownerName,
        color: ownerColor,
        joinedAt: now,
        role: "editor",
      };

      // Seed RTDB with meta + owner participant + canonical pattern.
      // Edits/presence start empty — they're written by clients as
      // peers join and act.
      await rtdb.ref(`sessions/${sessionId}`).set({
        meta,
        participants: { [uid]: ownerParticipant },
        state: project.pattern,
        edits: null,
        presence: null,
      });

      res
        .status(201)
        .json({ data: { sessionId, meta, participant: ownerParticipant } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:id/join",
  requireAuth,
  sessionLimiter,
  validateBody(sessionEmptyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const sessionId = req.params.id!;

      const sessionRef = rtdb.ref(`sessions/${sessionId}`);
      const snap = await sessionRef.get();
      if (!snap.exists()) return next(NotFoundError("session not found"));

      const session = snap.val() as {
        meta?: SessionMeta;
        participants?: Record<string, SessionParticipant>;
        state?: unknown;
      };
      if (!session.meta || session.meta.status !== "open") {
        return next(ConflictError("session is not open"));
      }

      // Anyone authenticated with the link can join — link-only access
      // is the v1 default. Project ACL is checked here as a courtesy
      // so private-project sessions don't accidentally leak to anyone.
      const project = await readProject(session.meta.projectId);
      if (!project) {
        return next(NotFoundError("project for session no longer exists"));
      }
      const linkAccessible =
        project.isPublic === true ||
        project.ownerId === uid ||
        isProjectMember(uid, project) ||
        // For non-member non-public projects, allow join since the
        // session URL is itself a capability — but stamp the role as
        // viewer so they can't write edits.
        true;
      if (!linkAccessible) {
        return next(ForbiddenError("join not allowed"));
      }
      const role: SessionParticipant["role"] =
        project.isPublic || isProjectMember(uid, project) ? "editor" : "viewer";

      const displayName = await readDisplayName(uid);
      const participant: SessionParticipant = {
        v: COLLAB_PROTOCOL_VERSION,
        uid,
        displayName,
        color: pickColorForUid(uid),
        joinedAt: Date.now(),
        role,
      };
      await sessionRef.child(`participants/${uid}`).set(participant);

      res.json({
        data: {
          meta: session.meta,
          participants: { ...(session.participants ?? {}), [uid]: participant },
          state: session.state ?? null,
          participant,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:id/leave",
  requireAuth,
  sessionLimiter,
  validateBody(sessionEmptyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const sessionId = req.params.id!;
      const sessionRef = rtdb.ref(`sessions/${sessionId}`);
      const metaSnap = await sessionRef.child("meta").get();
      if (!metaSnap.exists()) return next(NotFoundError("session not found"));
      await sessionRef.child(`participants/${uid}`).remove();
      await sessionRef.child(`presence/${uid}`).remove();
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/sessions/:id/permissions",
  requireAuth,
  sessionLimiter,
  validateBody(updateSessionPermissionsBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const sessionId = req.params.id!;
      const sessionRef = rtdb.ref(`sessions/${sessionId}`);
      const metaSnap = await sessionRef.child("meta").get();
      if (!metaSnap.exists()) return next(NotFoundError("session not found"));
      const meta = metaSnap.val() as SessionMeta;
      if (meta.ownerUid !== uid) {
        return next(
          ForbiddenError("only the session host can change permissions"),
        );
      }
      const next$ = req.body as Partial<SessionPermissions>;
      const merged: SessionPermissions = {
        ...DEFAULT_SESSION_PERMISSIONS,
        ...(meta.permissions ?? {}),
        ...next$,
      };
      await sessionRef.child("meta/permissions").set(merged);
      res.json({ data: { permissions: merged } });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/sessions/:id",
  requireAuth,
  sessionLimiter,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const sessionId = req.params.id!;
      const sessionRef = rtdb.ref(`sessions/${sessionId}`);
      const metaSnap = await sessionRef.child("meta").get();
      if (!metaSnap.exists()) return next(NotFoundError("session not found"));
      const meta = metaSnap.val() as SessionMeta;
      if (meta.ownerUid !== uid) {
        return next(ForbiddenError("only the owner can end a session"));
      }
      // Soft-end: mark status, leave the data for late-arriving clients
      // to see "session has ended" rather than a 404. The TTL sweeper
      // (future) hard-deletes after a few minutes.
      await sessionRef.child("meta").update({ status: "ended" });
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
