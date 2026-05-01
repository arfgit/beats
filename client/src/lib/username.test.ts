import { describe, it, expect } from "vitest";
import {
  RESERVED_USERNAMES,
  normalizeUsername,
  suggestUsernameFrom,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validateUsername,
} from "@beats/shared";

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  NeonRider  ")).toBe("neonrider");
  });

  it("preserves valid characters as-is", () => {
    expect(normalizeUsername("neon-rider-742")).toBe("neon-rider-742");
  });
});

describe("validateUsername", () => {
  it("accepts a canonical handle", () => {
    const result = validateUsername("neon-rider");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("neon-rider");
  });

  it("normalizes mixed case before validating", () => {
    const result = validateUsername("NeonRider");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("neonrider");
  });

  it("rejects too short", () => {
    const result = validateUsername("ab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_SHORT");
  });

  it("rejects too long", () => {
    const result = validateUsername("a".repeat(USERNAME_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_LONG");
  });

  it("rejects underscores (no underscore in v1 charset)", () => {
    const result = validateUsername("neon_rider");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CHARS");
  });

  it("rejects unicode lookalikes (Cyrillic а)", () => {
    // Cyrillic 'а' (U+0430) is a known confusable for Latin 'a'.
    const result = validateUsername("neonа-rider");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CHARS");
  });

  it("rejects leading hyphen", () => {
    const result = validateUsername("-neon");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_HYPHEN_PLACEMENT");
  });

  it("rejects trailing hyphen", () => {
    const result = validateUsername("neon-");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_HYPHEN_PLACEMENT");
  });

  it("rejects double hyphen", () => {
    const result = validateUsername("neon--rider");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_HYPHEN_PLACEMENT");
  });

  it("rejects every reserved slug that's within the length window", () => {
    // Reserved slugs shorter than USERNAME_MIN_LENGTH are already
    // rejected by the length check (which runs first); the reserved
    // entry is defense in depth in case the length minimum ever
    // changes.
    const inWindow = Array.from(RESERVED_USERNAMES).filter(
      (s) => s.length >= USERNAME_MIN_LENGTH && s.length <= USERNAME_MAX_LENGTH,
    );
    expect(inWindow.length).toBeGreaterThan(0);
    for (const reserved of inWindow) {
      const result = validateUsername(reserved);
      expect(result.ok, `expected ${reserved} reserved`).toBe(false);
      if (!result.ok) expect(result.code).toBe("RESERVED");
    }
  });

  it("accepts the boundary lengths", () => {
    expect(validateUsername("a".repeat(USERNAME_MIN_LENGTH)).ok).toBe(true);
    expect(validateUsername("a".repeat(USERNAME_MAX_LENGTH)).ok).toBe(true);
  });

  it("rejects empty input", () => {
    expect(validateUsername("").ok).toBe(false);
    expect(validateUsername("   ").ok).toBe(false);
  });

  it("accepts handles with digits", () => {
    expect(validateUsername("neon-rider-742").ok).toBe(true);
    expect(validateUsername("742").ok).toBe(true);
  });
});

describe("suggestUsernameFrom", () => {
  it("strips invalid characters from a Google displayName", () => {
    expect(suggestUsernameFrom("Anthony R. Feliz")).toBe("anthony-r-feliz");
  });

  it("collapses runs of hyphens", () => {
    expect(suggestUsernameFrom("Foo  ___  Bar")).toBe("foo-bar");
  });

  it("trims edge hyphens after stripping", () => {
    expect(suggestUsernameFrom("___FooBar___")).toBe("foobar");
  });

  it("truncates to USERNAME_MAX_LENGTH", () => {
    const long = "a".repeat(USERNAME_MAX_LENGTH + 10);
    expect(suggestUsernameFrom(long).length).toBe(USERNAME_MAX_LENGTH);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(suggestUsernameFrom("***")).toBe("");
    expect(suggestUsernameFrom("a")).toBe("");
  });

  it("returns empty string for reserved suggestions", () => {
    expect(suggestUsernameFrom("Admin")).toBe("");
  });

  it("produces a valid result for typical inputs", () => {
    const result = suggestUsernameFrom("Synthwave Producer");
    expect(result).toBe("synthwave-producer");
    expect(validateUsername(result).ok).toBe(true);
  });
});
