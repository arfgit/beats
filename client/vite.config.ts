import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "beats",
        short_name: "beats",
        description: "collaborative neon synthwave beat sequencer",
        theme_color: "#0a0518",
        background_color: "#0a0518",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // Firebase reserves `/__/*` on every Hosting site for its auth
        // handler, init scripts, and other helpers. The default Workbox
        // NavigationRoute would otherwise intercept popup navigations to
        // `/__/auth/handler` and serve cached `index.html`, which makes
        // Google sign-in pop a 404 page inside the popup window. The
        // `/api/*` exemption is defense-in-depth for the same reason —
        // those paths are rewritten to a Cloud Function in firebase.json
        // and must never be served the SPA shell. Regression test:
        // `vite.config.test.ts`. Do not remove without updating that test.
        navigateFallbackDenylist: [/^\/__\//, /^\/api\//],
        // Clean up caches written by old SW versions so a user upgrading
        // from an earlier deploy doesn't inherit a 300-entry firebase-
        // storage cache full of stale audio.
        cleanupOutdatedCaches: true,
        // Take control of open tabs as soon as a new SW activates —
        // removes the "reload twice to see the fix" dance after deploys.
        clientsClaim: true,
        skipWaiting: true,
        // NOTE: we deliberately do NOT intercept Firebase Storage /
        // `firebasestorage.googleapis.com` requests here. The old
        // CacheFirst rule threw `FetchEvent.respondWith: no-response`
        // whenever a fetch errored out (expired media tokens, slow
        // network, partial outages) because CacheFirst has no built-in
        // fallback Response — the rejected promise bubbled back as the
        // opaque no-response error the user saw. Firebase Storage sets
        // `Cache-Control: public, max-age=2592000` (30 days) via the
        // seed script, so the browser's native HTTP cache keeps the
        // samples around for re-hits without SW help. If offline-first
        // playback becomes a requirement, wrap a NetworkFirst strategy
        // with an explicit `handlerDidError` fallback that returns a
        // real Response — not a bare CacheFirst.
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@beats/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: [
            "firebase/app",
            "firebase/auth",
            "firebase/firestore",
            "firebase/storage",
          ],
          tone: ["tone"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
