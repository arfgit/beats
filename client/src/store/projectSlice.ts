import type { StateCreator } from "zustand";
import type { Pattern, Project, ProjectMatrix } from "@beats/shared";
import {
  isProjectMatrix,
  migratePattern,
  migratePatternToMatrix,
} from "@beats/shared";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { api, ApiCallError } from "@/lib/api";
import { dequeueSave, enqueueSave, listPending } from "@/lib/saveQueue";
import { buildMatrixFromPatternAndMatrix } from "./matrixSlice";
import type { BeatsStore } from "./useBeatsStore";

/**
 * Given a project doc straight out of Firestore, produce the pair we
 * drive the store with:
 *   - matrix: always v2 ProjectMatrix (auto-migrated from v1 if needed)
 *   - pattern: the flat legacy pattern for the currently-editable cell
 *     (first enabled, or cell 0 if none are enabled)
 */
function projectToStoreShape(project: Project): {
  matrix: ProjectMatrix;
  pattern: Pattern;
} {
  const raw = project.pattern;
  let matrix: ProjectMatrix;
  if (isProjectMatrix(raw)) {
    matrix = raw;
  } else {
    // v1 legacy — normalize via migratePattern (adds defaults for missing
    // fields) and wrap as cell 0 of a fresh matrix.
    matrix = migratePatternToMatrix(migratePattern(raw));
  }
  const focus = matrix.cells.find((c) => c.enabled) ?? matrix.cells[0]!;
  const pattern: Pattern = {
    schemaVersion: 1,
    bpm: matrix.sharedBpm,
    masterGain: matrix.masterGain,
    stepCount: focus.pattern.stepCount,
    tracks: focus.pattern.tracks,
    effects: focus.effects,
  };
  return { matrix, pattern };
}

export type SaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "error";

export interface ProjectSlice {
  project: {
    current: Project | null;
    dirty: boolean;
    saveStatus: SaveStatus;
    lastError: string | null;
    isLockOwner: boolean;
    applyingRemote: boolean;
    unsubscribeRemote: (() => void) | null;
  };
  createProject: (title: string, isPublic: boolean) => Promise<Project>;
  loadProject: (projectId: string) => Promise<void>;
  clearProject: () => void;
  markDirty: () => void;
  flushSave: () => Promise<void>;
  forkProject: () => Promise<Project | null>;
  setIsPublic: (isPublic: boolean) => Promise<void>;
  setTitle: (title: string) => Promise<void>;
  setLockOwner: (owner: boolean) => void;
  flushPendingQueue: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// In-flight save guard: prevents concurrent PATCH requests and ensures any
// edits that land during a save trigger a follow-up flush.
let saveInFlight = false;

export const createProjectSlice: StateCreator<
  BeatsStore,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  project: {
    current: null,
    dirty: false,
    saveStatus: "idle",
    lastError: null,
    isLockOwner: true,
    applyingRemote: false,
    unsubscribeRemote: null,
  },

  createProject: async (title, isPublic) => {
    // Build a v2 payload from the store's current matrix + pattern —
    // ensures the brand-new project starts life as ProjectMatrix on the
    // server (no v1 history to migrate later).
    const matrix = buildMatrixFromPatternAndMatrix(
      get().pattern,
      get().matrix,
      get().selectedCellId,
    );
    try {
      const created = await api.post<Project>("/projects", {
        title,
        pattern: matrix,
        isPublic,
      });
      set((s) => ({
        project: {
          ...s.project,
          current: created,
          dirty: false,
          saveStatus: "saved",
          lastError: null,
        },
        matrix,
      }));
      return created;
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "create failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
      throw err;
    }
  },

  loadProject: async (projectId) => {
    get().project.unsubscribeRemote?.();
    try {
      const unsub = onSnapshot(
        doc(db, "projects", projectId),
        (snap) => {
          if (!snap.exists()) {
            set((s) => ({
              project: {
                ...s.project,
                current: null,
                saveStatus: "error",
                lastError: "project missing",
              },
            }));
            return;
          }
          const project = snap.data() as Project;
          const { matrix, pattern } = projectToStoreShape(project);
          const isDirty = get().project.dirty;

          // Source-aware apply: when a remote snapshot lands while we have no
          // local edits, we want to mirror the new pattern/matrix into the
          // store WITHOUT the outer subscribe treating it as a user edit and
          // firing markDirty.
          if (!isDirty) {
            const firstEnabled =
              matrix.cells.find((c) => c.enabled) ?? matrix.cells[0]!;
            set((s) => ({
              project: {
                ...s.project,
                current: { ...project, pattern: matrix },
                saveStatus: "saved",
                lastError: null,
                applyingRemote: true,
              },
              pattern,
              matrix,
              selectedCellId: firstEnabled.id,
            }));
            // Flip the flag back on the next tick once the subscribe has fired
            setTimeout(() => {
              set((s) => ({
                project: { ...s.project, applyingRemote: false },
              }));
            }, 0);
          } else {
            // Local edits in flight — update the canonical `current` (revision,
            // collaborators, etc.) but keep our in-memory pattern/matrix.
            set((s) => ({
              project: {
                ...s.project,
                current: { ...project, pattern: matrix },
                lastError: null,
              },
            }));
          }
        },
        (err) => {
          set((s) => ({
            project: {
              ...s.project,
              saveStatus: "error",
              lastError: err.message,
            },
          }));
        },
      );
      set((s) => ({ project: { ...s.project, unsubscribeRemote: unsub } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "load failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
    }
  },

  clearProject: () => {
    get().project.unsubscribeRemote?.();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set((s) => ({
      project: {
        ...s.project,
        current: null,
        dirty: false,
        saveStatus: "idle",
        lastError: null,
        applyingRemote: false,
        unsubscribeRemote: null,
      },
    }));
  },

  markDirty: () => {
    // Remote snapshots apply through loadProject with applyingRemote=true;
    // the outer subscribe calls markDirty but we ignore it here to avoid a
    // save loop.
    if (get().project.applyingRemote) return;

    set((s) => ({
      project: { ...s.project, dirty: true, saveStatus: "dirty" },
    }));
    const current = get().project.current;
    if (!current) return;
    if (!get().project.isLockOwner) return;
    // While a live collab session is running, only the SESSION OWNER
    // (which equals the project owner — sessions are owner-started)
    // PATCHes Firestore. Other peers' edits travel through RTDB and
    // get folded into the owner's next save. Without this, every peer
    // would race to PATCH the same revision and trigger 409s.
    const session = get().collab.session;
    const myUid = get().auth.user?.id;
    if (session.id && session.meta && session.meta.ownerUid !== myUid) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().flushSave();
    }, SAVE_DEBOUNCE_MS);
  },

  flushSave: async () => {
    if (saveInFlight) return;
    const current = get().project.current;
    if (!current) return;
    if (!get().project.isLockOwner) return;

    saveInFlight = true;
    set((s) => ({ project: { ...s.project, saveStatus: "saving" } }));
    const patternSnapshot = get().pattern;
    const revisionSnapshot = current.revision;
    // Snapshot the matrix with current pattern edits merged into the
    // selected cell — this is what we persist. patternSnapshot is retained
    // so we can detect post-save edits below.
    const matrixSnapshot = buildMatrixFromPatternAndMatrix(
      patternSnapshot,
      get().matrix,
      get().selectedCellId,
    );

    try {
      const updated = await api.patch<Project>(
        `/projects/${current.id}`,
        { pattern: matrixSnapshot },
        { headers: { "If-Match": String(revisionSnapshot) } },
      );
      await dequeueSave(current.id);
      const patternChangedDuringSave = get().pattern !== patternSnapshot;
      set((s) => ({
        project: {
          ...s.project,
          current: updated,
          dirty: patternChangedDuringSave,
          saveStatus: patternChangedDuringSave ? "dirty" : "saved",
          lastError: null,
        },
        // Keep local matrix in sync with what we just persisted — next save
        // can diff against this without the pattern-mirror step re-creating
        // a stale cell.
        matrix: matrixSnapshot,
      }));
      // If the user kept editing during the save, queue another one.
      if (patternChangedDuringSave) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void get().flushSave(), SAVE_DEBOUNCE_MS);
      }
    } catch (err) {
      if (err instanceof ApiCallError && err.apiError.code === "CONFLICT") {
        set((s) => ({
          project: {
            ...s.project,
            saveStatus: "conflict",
            lastError: err.apiError.message,
          },
        }));
        return;
      }
      if (
        !navigator.onLine ||
        (err instanceof TypeError && err.message.includes("fetch"))
      ) {
        await enqueueSave({
          projectId: current.id,
          pattern: matrixSnapshot,
          queuedAt: Date.now(),
          revisionAtQueue: revisionSnapshot,
        });
        set((s) => ({
          project: { ...s.project, saveStatus: "offline", lastError: null },
        }));
        return;
      }
      const message =
        err instanceof ApiCallError ? err.apiError.message : "save failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
    } finally {
      saveInFlight = false;
    }
  },

  forkProject: async () => {
    const current = get().project.current;
    if (!current) return null;
    try {
      const fork = await api.post<Project>(`/projects/${current.id}/fork`);
      const { matrix: forkMatrix, pattern: forkPattern } =
        projectToStoreShape(fork);
      const firstEnabled =
        forkMatrix.cells.find((c) => c.enabled) ?? forkMatrix.cells[0]!;
      set((s) => ({
        project: {
          ...s.project,
          current: { ...fork, pattern: forkMatrix },
          dirty: false,
          saveStatus: "saved",
          applyingRemote: true,
        },
        pattern: forkPattern,
        matrix: forkMatrix,
        selectedCellId: firstEnabled.id,
      }));
      setTimeout(() => {
        set((s) => ({ project: { ...s.project, applyingRemote: false } }));
      }, 0);
      return fork;
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "fork failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
      return null;
    }
  },

  setIsPublic: async (isPublic) => {
    const current = get().project.current;
    if (!current) return;
    try {
      const updated = await api.patch<Project>(
        `/projects/${current.id}`,
        { isPublic },
        { headers: { "If-Match": String(current.revision) } },
      );
      set((s) => ({ project: { ...s.project, current: updated } }));
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "update failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
    }
  },

  setTitle: async (title) => {
    const current = get().project.current;
    if (!current) return;
    try {
      const updated = await api.patch<Project>(
        `/projects/${current.id}`,
        { title },
        { headers: { "If-Match": String(current.revision) } },
      );
      set((s) => ({ project: { ...s.project, current: updated } }));
    } catch (err) {
      const message =
        err instanceof ApiCallError ? err.apiError.message : "update failed";
      set((s) => ({
        project: { ...s.project, saveStatus: "error", lastError: message },
      }));
    }
  },

  setLockOwner: (owner) => {
    set((s) => ({ project: { ...s.project, isLockOwner: owner } }));
  },

  flushPendingQueue: async () => {
    const pending = await listPending();
    for (const save of pending) {
      try {
        await api.patch<Project>(
          `/projects/${save.projectId}`,
          { pattern: save.pattern },
          { headers: { "If-Match": String(save.revisionAtQueue) } },
        );
        await dequeueSave(save.projectId);
      } catch {
        // leave in queue for later retry
      }
    }
  },
});
