import { build } from "esbuild";

// Bundle the Functions entry. `@beats/shared` is resolved via the TS path
// alias (see tsconfig.json "paths") and inlined into the output — this is
// how we avoid publishing `@beats/shared` or using a workspace reference
// that Cloud Build's isolated `npm install` can't resolve. All real runtime
// dependencies (firebase-admin, express, etc.) stay external and are
// installed in the Functions container from package.json.
await build({
  entryPoints: ["src/functions.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/functions.js",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "info",
  // Banner lets the ESM output load CommonJS-only modules if any dep pulls
  // one in (firebase-functions internals historically have).
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  // Runtime deps — Cloud Build installs these; bundling them risks subtle
  // native/peer issues (especially firebase-functions' v2 triggers).
  external: [
    "firebase-admin",
    "firebase-admin/*",
    "firebase-functions",
    "firebase-functions/*",
    "express",
    "cors",
    "pino",
    "pino-http",
    "pino-pretty",
    "zod",
    "nanoid",
    "dotenv",
  ],
});
