import type { Pattern, ProjectMatrix } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";

const KEY = "beats:cache:v1";
const SCHEMA_VERSION = 1;

export interface CachedStudioState {
  schemaVersion: number;
  matrix: ProjectMatrix;
  selectedCellId: string;
  savedAt: number;
}

export function saveLocalCache(
  matrix: ProjectMatrix,
  selectedCellId: string,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: CachedStudioState = {
      schemaVersion: SCHEMA_VERSION,
      matrix,
      selectedCellId,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded, private browsing, corrupt storage — swallow: caching
    // is best-effort and must never break the app.
  }
}

export function loadLocalCache(): CachedStudioState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStudioState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.matrix?.cells?.length || !parsed.selectedCellId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
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
export function rehydrateFromLocalCache(): boolean {
  const cached = loadLocalCache();
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
