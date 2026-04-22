import { del, entries, set } from "idb-keyval";
import type { ProjectPattern } from "@beats/shared";

export interface QueuedSave {
  projectId: string;
  /**
   * Either a v1 Pattern or a v2 ProjectMatrix — server accepts both under
   * `pattern` (see C0 dual-accept). Stored queue entries survive the client
   * upgrade window without needing a format change.
   */
  pattern: ProjectPattern;
  title?: string;
  isPublic?: boolean;
  queuedAt: number;
  revisionAtQueue: number;
}

const KEY_PREFIX = "pending-save:";

/**
 * Persists the latest pending save per project in IndexedDB. Multiple saves
 * to the same project coalesce to the most recent. On reconnect, flush
 * walks entries and replays them through the BFF.
 */
export async function enqueueSave(save: QueuedSave): Promise<void> {
  await set(`${KEY_PREFIX}${save.projectId}`, save);
}

export async function dequeueSave(projectId: string): Promise<void> {
  await del(`${KEY_PREFIX}${projectId}`);
}

export async function listPending(): Promise<QueuedSave[]> {
  const all = await entries<string, QueuedSave>();
  return all
    .filter(([key]) => typeof key === "string" && key.startsWith(KEY_PREFIX))
    .map(([, value]) => value)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}
