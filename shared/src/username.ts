/**
 * Username (public handle) validation and helpers — shared between
 * client and server so a single regex defines both ends. Lowercase,
 * 3–20 chars, ASCII letters/digits/hyphens. No leading/trailing/double
 * hyphens. Reserved system slugs blocked.
 *
 * Why hyphens, no underscores: Twitter-style readability without
 * collision against URL slugs that already use underscore. A single
 * charset means generated handles ("neon-rider-742") and user-chosen
 * handles share the same validator — no per-source carve-outs that
 * drift apart.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Canonical username regex. Matches the lowercase canonical form. The
 * client should `normalizeUsername` first, then test, so user input
 * casing isn't a rejection reason.
 */
export const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;

/**
 * Reserved slugs that would shadow routes / tooling / impersonation
 * vectors. Lowercase comparison after `normalizeUsername`. Keep tight
 * — every entry is a potential UX papercut for someone who legitimately
 * wants that handle, but each is also a real conflict.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "beats",
  "billing",
  "docs",
  "help",
  "login",
  "logout",
  "me",
  "moderator",
  "null",
  "owner",
  "register",
  "root",
  "settings",
  "signin",
  "signout",
  "signup",
  "staff",
  "support",
  "system",
  "team",
  "undefined",
  "user",
  "users",
  "www",
]);

export interface UsernameValidationFailure {
  ok: false;
  code:
    | "TOO_SHORT"
    | "TOO_LONG"
    | "INVALID_CHARS"
    | "INVALID_HYPHEN_PLACEMENT"
    | "RESERVED";
  message: string;
}

export interface UsernameValidationSuccess {
  ok: true;
  /** Canonical lowercase form ready to write to `usernameLower`. */
  normalized: string;
}

export type UsernameValidationResult =
  | UsernameValidationSuccess
  | UsernameValidationFailure;

/**
 * Lowercase + trim. Doesn't strip invalid chars — pairing with
 * `validateUsername` surfaces clear errors instead of silently mutating
 * user intent.
 */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Validate a candidate username against the canonical rules. Pure —
 * no I/O. Server uses this as the gate before running the claim
 * transaction; client uses it for inline form feedback.
 */
export function validateUsername(input: string): UsernameValidationResult {
  const normalized = normalizeUsername(input);
  if (normalized.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      code: "TOO_SHORT",
      message: `username must be at least ${USERNAME_MIN_LENGTH} characters`,
    };
  }
  if (normalized.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      code: "TOO_LONG",
      message: `username must be at most ${USERNAME_MAX_LENGTH} characters`,
    };
  }
  if (normalized.startsWith("-") || normalized.endsWith("-")) {
    return {
      ok: false,
      code: "INVALID_HYPHEN_PLACEMENT",
      message: "username cannot start or end with a hyphen",
    };
  }
  if (normalized.includes("--")) {
    return {
      ok: false,
      code: "INVALID_HYPHEN_PLACEMENT",
      message: "username cannot contain consecutive hyphens",
    };
  }
  if (!USERNAME_REGEX.test(normalized)) {
    return {
      ok: false,
      code: "INVALID_CHARS",
      message: "username may only contain a–z, 0–9, and hyphens",
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      ok: false,
      code: "RESERVED",
      message: "that username is reserved",
    };
  }
  return { ok: true, normalized };
}

/**
 * Best-effort suggestion derived from a free-text source like a Google
 * displayName. Strips invalid chars, collapses runs of hyphens, trims
 * to USERNAME_MAX_LENGTH. Returns the empty string if nothing usable
 * remains — caller should fall back to a prompt.
 */
export function suggestUsernameFrom(source: string): string {
  const stripped = source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
  if (stripped.length < USERNAME_MIN_LENGTH) return "";
  if (RESERVED_USERNAMES.has(stripped)) return "";
  return stripped;
}
