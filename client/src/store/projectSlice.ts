import type { StateCreator } from "zustand";
import type { Pattern, Project } from "@beats/shared";
import { migratePattern } from "@beats/shared";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { api, ApiCallError } from "@/lib/api";
import { dequeueSave, enqueueSave, listPending } from "@/lib/saveQueue";
import type { BeatsStore } from "./useBeatsStore";

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
    unsubscribeRemote: null,
  },

  createProject: async (title, isPublic) => {
    const pattern = get().pattern;
    try {
      const created = await api.post<Project>("/projects", {
        title,
        pattern,
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
          const migrated: Pattern = migratePattern(project.pattern);
          set((s) => ({
            project: {
              ...s.project,
              current: { ...project, pattern: migrated },
              saveStatus: s.project.dirty ? s.project.saveStatus : "saved",
              lastError: null,
            },
            pattern: get().project.dirty ? s.pattern : migrated,
          }));
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
    set((s) => ({
      project: {
        ...s.project,
        current: null,
        dirty: false,
        saveStatus: "idle",
        lastError: null,
        unsubscribeRemote: null,
      },
    }));
  },

  markDirty: () => {
    set((s) => ({
      project: { ...s.project, dirty: true, saveStatus: "dirty" },
    }));
    const current = get().project.current;
    if (!current) return;
    if (!get().project.isLockOwner) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().flushSave();
    }, SAVE_DEBOUNCE_MS);
  },

  flushSave: async () => {
    const current = get().project.current;
    if (!current) return;
    if (!get().project.isLockOwner) return;

    set((s) => ({ project: { ...s.project, saveStatus: "saving" } }));
    const pattern = get().pattern;

    try {
      const updated = await api.patch<Project>(`/projects/${current.id}`, {
        pattern,
      });
      await dequeueSave(current.id);
      set((s) => ({
        project: {
          ...s.project,
          current: updated,
          dirty: false,
          saveStatus: "saved",
          lastError: null,
        },
      }));
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
          pattern,
          queuedAt: Date.now(),
          revisionAtQueue: current.revision,
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
    }
  },

  forkProject: async () => {
    const current = get().project.current;
    if (!current) return null;
    try {
      const fork = await api.post<Project>(`/projects/${current.id}/fork`);
      set((s) => ({
        project: {
          ...s.project,
          current: fork,
          dirty: false,
          saveStatus: "saved",
        },
        pattern: fork.pattern,
      }));
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
      const updated = await api.patch<Project>(`/projects/${current.id}`, {
        isPublic,
      });
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
      const updated = await api.patch<Project>(`/projects/${current.id}`, {
        title,
      });
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
        await api.patch<Project>(`/projects/${save.projectId}`, {
          pattern: save.pattern,
        });
        await dequeueSave(save.projectId);
      } catch {
        // leave in queue for later retry
      }
    }
  },
});
