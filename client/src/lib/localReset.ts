import { entries, del } from "idb-keyval";
import { clearAllLocalCaches } from "@/lib/localCache";

/**
 * Nuke every layer of client-side persistence and reload the page.
 *
 * Reset is the user-facing escape hatch when the app boots into a
 * confusing state — typically a stale localStorage matrix referencing
 * sample IDs the server no longer recognizes (the "tracks render but
 * audio is silent" failure). We clear everything we own:
 *
 *  1. localStorage `beats:cache:*` — the rehydrate matrix mirror.
 *  2. IndexedDB `pending-save:*` — queued offline saves. WARNING: this
 *     discards offline edits that haven't synced. The Reset button copy
 *     must surface that to the user.
 *  3. Service worker registrations + caches — eliminates the "old SW
 *     intercepts the request" class of bug. Workbox's autoUpdate would
 *     normally catch this, but explicit unregister is the surest path.
 *
 * Then reload, bypassing the HTTP cache where supported.
 */
export async function resetLocalState(): Promise<void> {
  clearAllLocalCaches();
  await clearPendingSaves();
  await unregisterServiceWorkers();
  await clearCacheStorage();
  reloadHard();
}

async function clearPendingSaves(): Promise<void> {
  try {
    const all = await entries<string, unknown>();
    await Promise.all(
      all
        .map(([key]) => key)
        .filter(
          (key): key is string =>
            typeof key === "string" && key.startsWith("pending-save:"),
        )
        .map((key) => del(key)),
    );
  } catch {
    // best effort — a transient IndexedDB error shouldn't block the rest
    // of the reset chain.
  }
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  } catch {
    // ignore
  }
}

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // ignore
  }
}

function reloadHard(): void {
  // location.reload() takes no argument in the spec, but most browsers
  // serve a fresh navigation when SW + Cache Storage are gone, so a plain
  // reload is sufficient. Adding a cache-busting query param defends
  // against intermediate proxies.
  const url = new URL(window.location.href);
  url.searchParams.set("_reset", Date.now().toString());
  window.location.replace(url.toString());
}
