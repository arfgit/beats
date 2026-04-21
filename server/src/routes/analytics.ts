import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { validateBody } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const limiter = createRateLimiter({ capacity: 120, refillPerMin: 120 });

const eventBody = z.object({
  name: z.string().min(1).max(64),
  props: z.record(z.string(), z.any()).default({}),
  ts: z.number().int().positive(),
});

router.post(
  "/analytics/event",
  requireAuth,
  limiter,
  validateBody(eventBody),
  (req: AuthedRequest, res) => {
    const body = req.body as {
      name: string;
      props: Record<string, unknown>;
      ts: number;
    };
    logger.info(
      { event: body.name, uid: req.auth!.uid, props: body.props, ts: body.ts },
      "analytics",
    );
    res.json({ data: { ok: true } });
  },
);

export default router;
