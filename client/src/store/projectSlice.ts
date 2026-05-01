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
  /**
   * Session-aware fork: when an invitee in a live session wants their
   * own copy of the host's project. Bypasses the read ACL because
   * session participation is the read capability — server verifies
   * the user is a participant in the open session.
   */
  forkSessionProject: () => Promise<Project | null>;
  setIsPublic: (isPublic: boolean) => Promise<void>;
  setTitle: (title: string) => Promise<void>;
  /**
   * Delete a project from Firestore. Owner-only on the server. Caller
   * is responsible for confirm UX. If the deleted project happens to
   * be the one currently loaded, the listener tear-down via
   * clearProject is handled here.
   */
  deleteProject: (projectId: string) => Promise<boolean>;
  setLockOwner: (owner: boolean) => void;
  flushPendingQueue: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 800;

export const createProjectSlice: StateCreator<
  BeatsStore,
  [],
  [],
  ProjectSlice
> = (set, get) => {
  // Closure-scoped so each store instance owns its own save mutex/timer.
  // Module scope used to leak across project loads and across test stores;
  // a hung fetch could leave saveInFlight=true forever, silently blocking
  // every future flush on the page.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;

  return {
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
      // Project switch flushes the custom-sample cache so the picker
      // reflects the new project's rig (per-project sample scope) on
      // the next fetchSamples('custom') call. Done lazily inside the
      // snapshot callback rather than upfront so the picker doesn't
      // visibly flash empty between projects — we only flush once we
      // see the snapshot is for a DIFFERENT project than what's
      // currently loaded.
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
            const previousProjectId = get().project.current?.id ?? null;
            if (previousProjectId !== project.id) {
              get().resetCustomSamples();
            }
            const { matrix, pattern } = projectToStoreShape(project);
            const isDirty = get().project.dirty;

            // Source-aware apply: when a remote snapshot lands while we have no
            // local edits, we want to mirror the new pattern/matrix into the
            // store WITHOUT the outer subscribe treating it as a user edit and
            // firing markDirty.
            if (!isDirty) {
              const firstEnabled =
                matrix.cells.find((c) => c.enabled) ?? matrix.cells[0]!;
              // Single synchronous burst: set with applyingRemote=true so
              // the subscribe chain skips markDirty / cache mirror, then
              // set false in the same task. Using setTimeout(0) here used
              // to leave a window where a user keystroke landing between
              // the first set and the macrotask was silently discarded by
              // markDirty's applyingRemote guard.
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
              set((s) => ({
                project: { ...s.project, applyingRemote: false },
              }));
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
      // Hard-reset the in-flight mutex. If a save's fetch never resolves
      // (the network just hangs), the finally that would have cleared this
      // flag never runs — and the next flushSave bails on the stale guard.
      // The corresponding flushSave detects a project switch via the id
      // snapshot below, so any late-arriving response is a no-op.
      saveInFlight = false;
      // Drop the project-scoped custom-sample cache so the picker
      // doesn't leak samples from the just-closed project into the
      // anon studio.
      get().resetCustomSamples();
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
      const projectIdAtStart = current.id;
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
        // The user may have switched projects (or signed out) while the
        // PATCH was in flight. Skip the state mutation in that case so
        // the success doesn't bleed onto a different project's slice.
        if (get().project.current?.id !== projectIdAtStart) return;
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
          saveTimer = setTimeout(
            () => void get().flushSave(),
            SAVE_DEBOUNCE_MS,
          );
        }
      } catch (err) {
        // Same stale-project guard as the success branch — if the user
        // navigated away during the PATCH, error reporting belongs on the
        // old project, not the new one.
        if (get().project.current?.id !== projectIdAtStart) return;
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

    forkSessionProject: async () => {
      const sessionId = get().collab.session.id;
      if (!sessionId) return null;
      try {
        const fork = await api.post<Project>(`/sessions/${sessionId}/fork`);
        // Hand off: gracefully leave the session so we stop receiving
        // host edits, then navigate via the SaveShareBar caller. We
        // intentionally don't pre-populate matrix/pattern here — the
        // route push to /studio/<forkId> drives loadProject which
        // hydrates state correctly without a flash of stale content.
        void get().leaveSession();
        get().pushToast("success", "forked to your account");
        return fork;
      } catch (err) {
        const message =
          err instanceof ApiCallError ? err.apiError.message : "fork failed";
        get().pushToast("error", message);
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
        // If the host is in a live session on this project, mirror the
        // new title into the session meta so invitees' guest banner
        // updates in real time. RTDB rules allow only the session owner
        // to write meta/projectTitle.
        const session = get().collab.session;
        const myUid = get().auth.user?.id ?? null;
        if (
          session.id &&
          session.meta &&
          session.meta.projectId === current.id &&
          session.meta.ownerUid === myUid
        ) {
          try {
            const { ref: dbRef, set: dbSet } =
              await import("firebase/database");
            const { rtdb } = await import("@/lib/firebase");
            await dbSet(
              dbRef(rtdb, `sessions/${session.id}/meta/projectTitle`),
              updated.title,
            );
          } catch (err) {
            console.warn("[collab] mirror title to session failed", err);
          }
        }
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

    deleteProject: async (projectId) => {
      try {
        await api.delete(`/projects/${projectId}`);
        // If we just deleted the actively-loaded project, tear down the
        // listener and reset to a fresh studio. Other delete cases
        // (deleting a project from the sidebar that isn't loaded) leave
        // the active project alone — Firestore will sync the deletion
        // through the project list snapshot.
        if (get().project.current?.id === projectId) {
          get().clearProject();
        }
        get().pushToast("success", "project deleted");
        return true;
      } catch (err) {
        const message =
          err instanceof ApiCallError ? err.apiError.message : "delete failed";
        get().pushToast("error", message);
        return false;
      }
    },

    flushPendingQueue: async () => {
      const pending = await listPending();
      let conflicted = 0;
      for (const save of pending) {
        try {
          await api.patch<Project>(
            `/projects/${save.projectId}`,
            { pattern: save.pattern },
            { headers: { "If-Match": String(save.revisionAtQueue) } },
          );
          await dequeueSave(save.projectId);
        } catch (err) {
          if (err instanceof ApiCallError && err.apiError.code === "CONFLICT") {
            // Stale revision — the server has moved on (a different device or
            // collab session wrote between when this save was queued and now).
            // No amount of retry will reconcile a missing diff, so drop the
            // entry and tell the user. Without this the queue retries forever.
            await dequeueSave(save.projectId);
            conflicted++;
          }
          // Otherwise transient (offline, fetch error) — leave in queue.
        }
      }
      if (conflicted > 0) {
        get().pushToast(
          "warn",
          conflicted === 1
            ? "an offline edit couldn't be applied (server has a newer version)"
            : `${conflicted} offline edits couldn't be applied (server has newer versions)`,
        );
      }
    },
  };
};
