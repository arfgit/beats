import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Tripwire for the Firebase auth-popup-404 bug. The PWA service worker's
// default NavigationRoute will intercept popup navigations to
// `/__/auth/handler` and serve cached `index.html` unless the workbox
// config exempts the Firebase reserved namespace. If you're editing
// `vite.config.ts` and this test fails, do not "fix" it by deleting the
// assertion — restore the denylist instead, or Google sign-in will break.
//
// Lives under src/test/ rather than next to vite.config.ts because Vitest's
// default `exclude` pattern blocks any `*vite.config*` filename from being
// collected as a test.
describe("vite.config workbox", () => {
  const source = readFileSync(
    resolve(__dirname, "../../vite.config.ts"),
    "utf-8",
  );

  it("excludes Firebase reserved namespace from SW navigation fallback", () => {
    expect(source).toMatch(/navigateFallbackDenylist\s*:/);
    expect(source).toMatch(/\/\^\\\/__\\\//);
  });

  it("excludes /api/ from SW navigation fallback", () => {
    expect(source).toMatch(/\/\^\\\/api\\\//);
  });
});
