import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { validateBody } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const router = Router();
const limiter = createRateLimiter({ capacity: 120, refillPerMin: 120 });

// Scalar-only props with key/value caps prevents log injection and
// deeply-nested payloads from leaking into log aggregation.
const propValue = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const eventBody = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_.-]+$/i, "alphanumeric, dot, underscore, dash only"),
  props: z.record(z.string().max(64), propValue).default({}),
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
