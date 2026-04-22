/**
 * Username / display-name validation shared across client and server.
 * The blocklist here is a practical-not-perfect approach: it catches
 * the obvious slurs and common crude terms, with de-obfuscation for the
 * common "leetspeak" substitutions (l33t). For production use a
 * dedicated moderation service (WebPurify, Perspective API, OpenAI
 * moderation) and call it in addition to this local check.
 */

const LENGTH_MIN = 2;
const LENGTH_MAX = 80;

// Root forms only. Matcher normalizes the input before comparing so
// "N1GG3R", "n-i-g-g-e-r", "Ni💩gger" all collapse to the root.
// Keep this list conservative — false positives on legitimate names are
// worse than a miss that a moderator catches later.
const BLOCKED_ROOTS = [
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "retard",
  "kike",
  "chink",
  "spic",
  "kyke",
  "gook",
  "wetback",
  "cunt",
  "whore",
  "slut",
  "pedophile",
  "pedo",
  "rapist",
  "nazi",
  "hitler",
  "kkk",
  "heil",
];

// Common leet → letter map. Done before the blocklist check.
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
};

function normalize(input: string): string {
  const lowered = input.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (LEET_MAP[ch]) {
      out += LEET_MAP[ch];
    } else if (/[a-z]/.test(ch)) {
      out += ch;
    }
    // Strip separators, emoji, and all non-letter noise so "n-i-g" → "nig".
  }
  return out;
}

export interface DisplayNameValidation {
  valid: boolean;
  reason?: string;
}

export function validateDisplayName(raw: string): DisplayNameValidation {
  if (typeof raw !== "string") {
    return { valid: false, reason: "display name must be text" };
  }
  const trimmed = raw.trim();
  if (trimmed.length < LENGTH_MIN) {
    return {
      valid: false,
      reason: `display name must be at least ${LENGTH_MIN} characters`,
    };
  }
  if (trimmed.length > LENGTH_MAX) {
    return {
      valid: false,
      reason: `display name must be at most ${LENGTH_MAX} characters`,
    };
  }
  if (/^\s*$/.test(trimmed)) {
    return { valid: false, reason: "display name cannot be blank" };
  }

  const normalized = normalize(trimmed);
  for (const root of BLOCKED_ROOTS) {
    if (normalized.includes(root)) {
      return {
        valid: false,
        // Don't echo the blocked term back to the user; just say the rule.
        reason: "display name contains language we don't allow",
      };
    }
  }

  return { valid: true };
}

// Email validator — we still only accept Google-OAuth-provided emails
// on the server, but this is useful for client-side feedback if we ever
// allow manual entry in the future. Scoped to the same shared surface
// so the rules stay in one place.
export function validateEmail(raw: string): DisplayNameValidation {
  if (typeof raw !== "string") {
    return { valid: false, reason: "email must be text" };
  }
  const trimmed = raw.trim();
  // Pragmatic check — RFC 5322 is a can of worms. This catches the 99%.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, reason: "enter a valid email address" };
  }
  if (trimmed.length > 254) {
    return { valid: false, reason: "email too long" };
  }
  return { valid: true };
}
