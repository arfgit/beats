/**
 * Per-project single-writer lock using BroadcastChannel.
 *
 * First tab to acquire becomes the "owner" and can edit/save. Other tabs
 * listening on the same project receive a notice and go read-only. The
 * owner emits a heartbeat on an interval so newcomers can see it. If the
 * owner stops heartbeating for longer than LIVENESS_WINDOW_MS, any other
 * tab will deterministically reclaim (lowest tabId wins).
 */
export type LockEvent =
  | { kind: "claim"; tabId: string; timestamp: number }
  | { kind: "heartbeat"; tabId: string; timestamp: number }
  | { kind: "release"; tabId: string };

export interface MultiTabLock {
  readonly isOwner: () => boolean;
  readonly onChange: (cb: (isOwner: boolean) => void) => () => void;
  release: () => void;
}

const HEARTBEAT_INTERVAL_MS = 1500;
const LIVENESS_WINDOW_MS = 4000;
const RECLAIM_CHECK_MS = 1000;

export function acquireLock(projectId: string, tabId: string): MultiTabLock {
  const channel = new BroadcastChannel(`beats-project-${projectId}`);
  let owner = true;
  let currentOwnerId: string = tabId;
  let lastForeignHeartbeat = 0;
  const listeners = new Set<(isOwner: boolean) => void>();

  const announce = (event: LockEvent) => channel.postMessage(event);
  const fireChange = () => {
    for (const cb of listeners) cb(owner);
  };

  channel.onmessage = (evt: MessageEvent<LockEvent>) => {
    const msg = evt.data;
    if (msg.tabId === tabId) return;

    if (msg.kind === "claim" || msg.kind === "heartbeat") {
      lastForeignHeartbeat = Date.now();
      // Lower tabId wins ties — deterministic and stable
      if (owner && msg.tabId < tabId) {
        owner = false;
        currentOwnerId = msg.tabId;
        fireChange();
      } else if (!owner) {
        currentOwnerId = msg.tabId;
      }
    } else if (
      msg.kind === "release" &&
      !owner &&
      msg.tabId === currentOwnerId
    ) {
      // Peer owner released — force the liveness check to reclaim on next tick
      lastForeignHeartbeat = 0;
    }
  };

  announce({ kind: "claim", tabId, timestamp: Date.now() });
  const heartbeat = window.setInterval(() => {
    if (owner) announce({ kind: "heartbeat", tabId, timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  // Periodic liveness check. If we're not the owner and we haven't heard
  // from the owner in LIVENESS_WINDOW_MS, reclaim.
  const livenessCheck = window.setInterval(() => {
    if (owner) return;
    const silentFor = Date.now() - lastForeignHeartbeat;
    if (silentFor >= LIVENESS_WINDOW_MS) {
      owner = true;
      currentOwnerId = tabId;
      announce({ kind: "claim", tabId, timestamp: Date.now() });
      fireChange();
    }
  }, RECLAIM_CHECK_MS);

  // Release on page unload so peers can reclaim promptly on graceful close.
  const onUnload = () => announce({ kind: "release", tabId });
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("pagehide", onUnload);

  return {
    isOwner: () => owner,
    onChange: (cb) => {
      listeners.add(cb);
      cb(owner);
      return () => listeners.delete(cb);
    },
    release: () => {
      window.clearInterval(heartbeat);
      window.clearInterval(livenessCheck);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      announce({ kind: "release", tabId });
      channel.close();
      owner = false;
      fireChange();
    },
  };
}
