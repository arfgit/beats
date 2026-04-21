import type { ApiError, ApiResponse } from "@beats/shared";
import { auth } from "./firebase";
import { env } from "./env";

export class ApiCallError extends Error {
  readonly apiError: ApiError;
  readonly status: number;

  constructor(apiError: ApiError, status: number) {
    super(apiError.message);
    this.name = "ApiCallError";
    this.apiError = apiError;
    this.status = status;
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value);
  }

  const res = await fetch(`${env.apiBase}${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as ApiResponse<T>;

  if (!res.ok || "error" in body) {
    const err =
      "error" in body
        ? body.error
        : {
            code: "INTERNAL" as const,
            message: res.statusText,
            requestId: "-",
          };
    throw new ApiCallError(err, res.status);
  }
  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(
      path,
      { method: "POST", body: JSON.stringify(body ?? {}) },
      options,
    ),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(
      path,
      { method: "PATCH", body: JSON.stringify(body ?? {}) },
      options,
    ),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
