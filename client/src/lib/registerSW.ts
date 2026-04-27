import { registerSW } from "virtual:pwa-register";

/**
 * Register the PWA service worker. Aggressive update strategy: poll
 * every 60 seconds, recheck when the tab regains focus, and auto-reload
 * the page once the new SW takes control. The combination minimizes
 * the window where a tab keeps running an old JS bundle after a deploy.
 *
 * Why so aggressive: with `skipWaiting: true` + `clientsClaim: true`
 * the new SW activates immediately, but the JS already running in the
 * tab is still the old chunk hash. Without forcing a reload on the
 * `controllerchange` event, users would have to manually refresh to
 * pick up freshly-deployed fixes — that's the "my changes still
 * haven't been added" symptom we want to eliminate.
 */
export function startServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;

  // Reload the page once a new SW takes control. `controllerchange`
  // fires after the activating SW calls `clients.claim()`. We guard
  // against the initial install (when no controller existed) so a
  // brand-new visit doesn't reload itself.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    window.location.reload();
  });

  const updater = registerSW({
    immediate: true,
    onRegisteredSW: (_swUrl, registration) => {
      if (!registration) return;
      const checkForUpdate = () =>
        void registration.update().catch(() => undefined);
      // Poll once a minute. Cheap (HEAD on the manifest) and keeps the
      // freshness window short for users who leave the tab open.
      setInterval(checkForUpdate, 60 * 1000);
      // Also recheck when the user comes back to the tab — covers the
      // "left it open overnight, now what's new" case without waiting
      // for the next interval tick.
      window.addEventListener("focus", checkForUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    },
    onNeedRefresh: () => {
      // skipWaiting+clientsClaim means the new SW activates on its
      // own. updateSW() simply ensures we don't sit on a waiting SW
      // if the workbox runtime is configured against auto-skip.
      void updater(true);
    },
    onOfflineReady: () => {
       
      console.info("[pwa] offline ready");
    },
  });
}
