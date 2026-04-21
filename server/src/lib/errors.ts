import type { ApiError, ApiErrorCode } from "@beats/shared";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toApiError(requestId: string): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      requestId,
    };
  }
}

export const UnauthorizedError = (msg = "unauthorized") =>
  new AppError("UNAUTHORIZED", msg, 401);
export const ForbiddenError = (msg = "forbidden") =>
  new AppError("FORBIDDEN", msg, 403);
export const NotFoundError = (msg = "not found") =>
  new AppError("NOT_FOUND", msg, 404);
export const ConflictError = (msg = "conflict") =>
  new AppError("CONFLICT", msg, 409);
export const ValidationError = (msg: string, details?: unknown) =>
  new AppError("VALIDATION", msg, 400, details);
