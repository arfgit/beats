import { registerSW } from "virtual:pwa-register";

/** Register the PWA service worker. Silent auto-updates; logs on new release. */
export function startServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  registerSW({
    immediate: true,
    onRegisteredSW: (_swUrl, registration) => {
      // Poll for updates hourly — cheap since the manifest is static.
      if (registration) {
        setInterval(
          () => registration.update().catch(() => undefined),
          60 * 60 * 1000,
        );
      }
    },
    onOfflineReady: () => {
      // eslint-disable-next-line no-console
      console.info("[pwa] offline ready");
    },
  });
}
