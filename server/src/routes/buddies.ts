import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import { normalizeBuddyCode } from "@beats/shared";
import {
  acceptBuddyRequest,
  createBuddyRequest,
  declineBuddyRequest,
  ensureBuddyCode,
  lookupBuddyCode,
  removeBuddyConnection,
} from "../services/buddy-service.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { connectBuddyBody, sessionEmptyBody } from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const codeReadLimiter = createRateLimiter({ capacity: 30, refillPerMin: 60 });
const connectLimiter = createRateLimiter({ capacity: 10, refillPerMin: 10 });
const requestActionLimiter = createRateLimiter({
  capacity: 20,
  refillPerMin: 30,
});

// GET /api/me/buddy-code — lazy-generates on first call.
router.get(
  "/me/buddy-code",
  requireAuth,
  codeReadLimiter,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const code = await ensureBuddyCode(uid);
      res.json({ data: { code } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/buddies/connect { code } — find recipient, write paired
// pending requests on both sides. Idempotent on retry.
router.post(
  "/buddies/connect",
  requireAuth,
  connectLimiter,
  validateBody(connectBuddyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const { code } = req.body as { code: string };
      const normalized = normalizeBuddyCode(code);

      const toUid = await lookupBuddyCode(normalized);
      if (!toUid) return next(NotFoundError("buddy code not found"));
      if (toUid === uid) {
        return next(ValidationError("cannot connect to your own code"));
      }

      const requestId = nanoid(14);
      try {
        const request = await createBuddyRequest(uid, toUid, requestId);
        res.status(201).json({ data: { requestId: request.id } });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ALREADY_BUDDIES") {
          return next(ConflictError("already buddies"));
        }
        if (code === "SELF_REFERENCE") {
          return next(ValidationError("cannot buddy yourself"));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/buddies/requests/:id/accept — caller must be the recipient.
router.post(
  "/buddies/requests/:id/accept",
  requireAuth,
  requestActionLimiter,
  validateBody(sessionEmptyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const requestId = req.params.id!;
      try {
        const buddy = await acceptBuddyRequest(uid, requestId);
        res.json({ data: { buddy } });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "NOT_FOUND")
          return next(NotFoundError("request not found"));
        if (code === "FORBIDDEN") return next(ForbiddenError("recipient only"));
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/buddies/requests/:id/decline — either party can decline.
router.post(
  "/buddies/requests/:id/decline",
  requireAuth,
  requestActionLimiter,
  validateBody(sessionEmptyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      await declineBuddyRequest(uid, req.params.id!);
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/buddies/:uid — break a buddy edge from both sides.
router.delete(
  "/buddies/:uid",
  requireAuth,
  requestActionLimiter,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const otherUid = req.params.uid!;
      if (otherUid === uid) {
        return next(ValidationError("cannot remove yourself"));
      }
      await removeBuddyConnection(uid, otherUid);
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
