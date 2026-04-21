/**
 * Per-project single-writer lock using BroadcastChannel.
 *
 * First tab to acquire becomes the "owner" and can edit/save. Other tabs
 * listening on the same project receive a notice and go read-only. The
 * owner announces its presence on an interval so newcomers can see it.
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

export function acquireLock(projectId: string, tabId: string): MultiTabLock {
  const channel = new BroadcastChannel(`beats-project-${projectId}`);
  let owner = true;
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
      lastForeignHeartbeat = msg.timestamp;
      // lower-tabId wins ties — deterministic and stable
      if (owner && msg.tabId < tabId) {
        owner = false;
        fireChange();
      }
    }
    if (msg.kind === "release" && !owner) {
      // peer released; reclaim if no one else claims within one heartbeat
      setTimeout(() => {
        if (Date.now() - lastForeignHeartbeat > LIVENESS_WINDOW_MS) {
          owner = true;
          fireChange();
          announce({ kind: "claim", tabId, timestamp: Date.now() });
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
  };

  announce({ kind: "claim", tabId, timestamp: Date.now() });
  const heartbeat = window.setInterval(() => {
    if (owner) announce({ kind: "heartbeat", tabId, timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  return {
    isOwner: () => owner,
    onChange: (cb) => {
      listeners.add(cb);
      cb(owner);
      return () => listeners.delete(cb);
    },
    release: () => {
      window.clearInterval(heartbeat);
      announce({ kind: "release", tabId });
      channel.close();
      owner = false;
      fireChange();
    },
  };
}
