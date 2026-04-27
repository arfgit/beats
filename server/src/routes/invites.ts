import { Router, type NextFunction, type Response } from "express";
import { nanoid } from "nanoid";
import { declineInvite, sendInvite } from "../services/invite-service.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { validateBody } from "../lib/validate.js";
import { sendInviteBody, sessionEmptyBody } from "../lib/schemas.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
// Per-sender cap. 3 invites with refill 6/min lets a user invite a
// few buddies in quick succession but throttles spam (per-(sender,
// recipient) caps live in the service in v2).
const sendLimiter = createRateLimiter({ capacity: 3, refillPerMin: 6 });
const declineLimiter = createRateLimiter({ capacity: 20, refillPerMin: 30 });

router.post(
  "/invites",
  requireAuth,
  sendLimiter,
  validateBody(sendInviteBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      const { toUid, sessionId } = req.body as {
        toUid: string;
        sessionId: string;
      };
      const inviteId = nanoid(14);
      try {
        const result = await sendInvite({
          fromUid: uid,
          toUid,
          sessionId,
          inviteId,
        });
        res.status(201).json({ data: { inviteId: result.inviteId } });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "SESSION_NOT_FOUND" || code === "PROJECT_NOT_FOUND") {
          return next(NotFoundError("session not found"));
        }
        if (code === "NOT_IN_SESSION") {
          return next(ForbiddenError("you are not in this session"));
        }
        if (code === "NOT_BUDDIES") {
          return next(ForbiddenError("recipient is not a buddy"));
        }
        if (code === "RECIPIENT_BUSY") {
          return next(ConflictError("recipient is in another session"));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/invites/:id/decline",
  requireAuth,
  declineLimiter,
  validateBody(sessionEmptyBody),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.auth!;
      await declineInvite({ callerUid: uid, inviteId: req.params.id! });
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
