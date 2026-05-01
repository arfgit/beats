import type { Request, Response, NextFunction } from "express";
import { adminAuth } from "../services/firebase-admin.js";
import { logger } from "./logger.js";
import { UnauthorizedError } from "./errors.js";

export interface AuthedRequest extends Request {
  auth?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
    role?: "user" | "admin";
    /** Firebase sign-in provider, e.g. "google.com" or "password". */
    signInProvider?: string;
  };
}

export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return next(UnauthorizedError("missing bearer token"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.auth = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      role: (decoded.role as "user" | "admin" | undefined) ?? "user",
      signInProvider: decoded.firebase?.sign_in_provider,
    };
    next();
  } catch (err) {
    logger.warn({ err }, "token verification failed");
    next(UnauthorizedError("invalid token"));
  }
}

export function requireAdmin(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (req.auth?.role !== "admin") return next(UnauthorizedError("admin only"));
  next();
}
