import type { Pattern, ProjectMatrix } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";

const KEY_PREFIX = "beats:cache:v2:";
const SCHEMA_VERSION = 2;
const ANON_BUCKET = "anon";

// 7 days. A user who hasn't touched the app for a week is more likely to
// hit stale-sample-ref errors after re-deploys / sample-pool drift than
// to miss the rehydrate. Beyond a week, refetching from the server is the
// safer default. Tune downward if drift is observed sooner.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedStudioState {
  schemaVersion: number;
  matrix: ProjectMatrix;
  selectedCellId: string;
  savedAt: number;
}

function bucketKey(userId: string | null): string {
  return `${KEY_PREFIX}${userId ?? ANON_BUCKET}`;
}

function currentUserId(): string | null {
  return useBeatsStore.getState().auth.user?.id ?? null;
}

export function saveLocalCache(
  matrix: ProjectMatrix,
  selectedCellId: string,
  userId: string | null = currentUserId(),
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: CachedStudioState = {
      schemaVersion: SCHEMA_VERSION,
      matrix,
      selectedCellId,
      savedAt: Date.now(),
    };
    localStorage.setItem(bucketKey(userId), JSON.stringify(payload));
    // After the first authed-bucket write the anon bucket has been fully
    // migrated forward — drop it so a later sign-out doesn't resurrect a
    // stale draft that the user has already moved past.
    if (userId) localStorage.removeItem(bucketKey(null));
  } catch {
    // quota exceeded, private browsing, corrupt storage — swallow: caching
    // is best-effort and must never break the app.
  }
}

function readBucket(key: string): CachedStudioState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStudioState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.matrix?.cells?.length || !parsed.selectedCellId) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadLocalCache(
  userId: string | null = currentUserId(),
): CachedStudioState | null {
  if (typeof localStorage === "undefined") return null;
  const direct = readBucket(bucketKey(userId));
  if (direct) return direct;
  // Migration fallback: a user who built a draft while signed-out then
  // signed in has the matrix sitting in the anon bucket. Read it forward
  // on first authed boot; the next saveLocalCache call promotes it into
  // the user's bucket and clears the anon copy.
  if (userId) return readBucket(bucketKey(null));
  return null;
}

export function clearLocalCache(userId: string | null = currentUserId()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(bucketKey(userId));
  } catch {
    // ignore
  }
}

/**
 * Drop every `beats:cache:*` entry across all user buckets and any legacy
 * unversioned key. Used by the Reset Local Data action — when the user
 * is recovering from stale-state corruption they don't care which bucket
 * the bad payload sits in.
 */
export function clearAllLocalCaches(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("beats:cache:")) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Restore pattern/matrix/selectedCellId from localStorage if a cache is
 * present. Mirrors the atomic-set pattern used by loadProject so a single
 * store update covers all three cross-slice fields plus the applyingRemote
 * guard that suppresses the mirror + autosave side-effects.
 *
 * Returns true when a cache was found and applied.
 */
export function rehydrateFromLocalCache(
  userId: string | null = currentUserId(),
): boolean {
  const cached = loadLocalCache(userId);
  if (!cached) return false;
  const focus =
    cached.matrix.cells.find((c) => c.id === cached.selectedCellId) ??
    cached.matrix.cells.find((c) => c.enabled) ??
    cached.matrix.cells[0];
  if (!focus) return false;
  const pattern: Pattern = {
    schemaVersion: 1,
    bpm: cached.matrix.sharedBpm,
    masterGain: cached.matrix.masterGain,
    stepCount: focus.pattern.stepCount,
    tracks: focus.pattern.tracks,
    effects: focus.effects,
  };
  useBeatsStore.setState((s) => ({
    pattern,
    matrix: cached.matrix,
    selectedCellId: focus.id,
    project: { ...s.project, applyingRemote: true },
  }));
  // Release the guard on the next microtask so subsequent user edits are
  // treated as normal local edits.
  setTimeout(() => {
    useBeatsStore.setState((s) => ({
      project: { ...s.project, applyingRemote: false },
    }));
  }, 0);
  return true;
}
