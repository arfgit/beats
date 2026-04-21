import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
import { AppError } from "./errors.js";

interface Bucket {
  tokens: number;
  refillAt: number;
}

/**
 * In-memory token bucket per uid. Good for single-instance dev + small deploys.
 * Cloud Functions with multiple instances would need a shared store (Redis,
 * Firestore) — deferred until actual abuse materializes.
 */
export function createRateLimiter({
  capacity,
  refillPerMin,
}: {
  capacity: number;
  refillPerMin: number;
}) {
  const buckets = new Map<string, Bucket>();
  const refillIntervalMs = 60_000 / refillPerMin;

  return function rateLimit(
    req: AuthedRequest,
    _res: Response,
    next: NextFunction,
  ): void {
    const key = req.auth?.uid ?? req.ip ?? "anon";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, refillAt: now + refillIntervalMs };
      buckets.set(key, bucket);
    }
    if (now >= bucket.refillAt) {
      const elapsed = now - bucket.refillAt + refillIntervalMs;
      const refilled = Math.floor(elapsed / refillIntervalMs);
      bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
      bucket.refillAt = now + refillIntervalMs;
    }
    if (bucket.tokens <= 0) {
      next(new AppError("RATE_LIMITED", "too many requests", 429));
      return;
    }
    bucket.tokens -= 1;
    next();
  };
}
