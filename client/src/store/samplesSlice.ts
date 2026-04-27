import type { StateCreator } from "zustand";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import type { SampleRef, TrackKind } from "@beats/shared";
import { TRACK_KINDS } from "@beats/shared";
import { db, storage } from "@/lib/firebase";
import { env } from "@/lib/env";
import { api } from "@/lib/api";
import type { BeatsStore } from "./useBeatsStore";

interface KindState {
  status: "idle" | "loading" | "ready" | "error";
  samples: SampleRef[];
  error: string | null;
}

function emptyKindState(): KindState {
  return { status: "idle", samples: [], error: null };
}

export interface SamplesSlice {
  samples: Record<TrackKind, KindState>;
  urlCache: Record<string, string>;
  fetchSamples: (kind: TrackKind) => Promise<void>;
  resolveSampleUrl: (sample: SampleRef) => Promise<string>;
  findSampleById: (id: string) => SampleRef | undefined;
  /**
   * Insert a freshly-uploaded custom sample at the head of the list
   * without a refetch. Idempotent on `id` — replaces an existing entry
   * rather than duplicating, so retries from the upload flow are safe.
   */
  addCustomSample: (sample: SampleRef) => void;
  /** Remove a deleted custom sample from the in-memory list. */
  removeCustomSample: (id: string) => void;
  /**
   * Forget the cached "custom" samples so the next fetchSamples('custom')
   * re-queries — used on project change so the sample picker shows the
   * new project's rig instead of the previous project's.
   */
  resetCustomSamples: () => void;
}

export const createSamplesSlice: StateCreator<
  BeatsStore,
  [],
  [],
  SamplesSlice
> = (set, get) => ({
  // Derive the initial per-kind map from TRACK_KINDS so adding a new
  // instrument type (e.g. "fx") only requires a constants update, not
  // another manual entry here.
  samples: Object.fromEntries(
    TRACK_KINDS.map((k) => [k, emptyKindState()]),
  ) as Record<TrackKind, KindState>,
  urlCache: {},

  fetchSamples: async (kind) => {
    const existing = get().samples[kind];
    if (existing.status === "loading" || existing.status === "ready") return;
    // "custom" samples are owner-scoped — short-circuit when signed out
    // rather than firing a query that Firestore rules will reject. The
    // empty-state UI prompts the user to sign in to upload.
    const uid = get().auth.user?.id ?? null;
    if (kind === "custom" && !uid) {
      set((s) => ({
        samples: {
          ...s.samples,
          custom: { status: "ready", samples: [], error: null },
        },
      }));
      return;
    }
    set((s) => ({
      samples: {
        ...s.samples,
        [kind]: { ...s.samples[kind], status: "loading" },
      },
    }));
    try {
      let samples: SampleRef[];
      if (kind === "custom") {
        // Project-scoped sample rig. When a project is loaded, show
        // samples uploaded for THAT project. When none is loaded
        // (anon / fresh studio), fall back to the user's owner-scoped
        // legacy samples so solo work still has a sample list.
        // status="ready" filter strips pending uploads that never
        // finalized so abandoned uploads don't pollute the picker.
        const projectId = get().project.current?.id ?? null;
        let customQ;
        if (projectId) {
          customQ = query(
            collection(db, "samples"),
            where("kind", "==", "custom"),
            where("projectId", "==", projectId),
          );
        } else {
          customQ = query(
            collection(db, "samples"),
            where("kind", "==", "custom"),
            where("ownerId", "==", uid),
          );
        }
        const snap = await getDocs(customQ);
        samples = snap.docs
          .map((d) => d.data() as SampleRef & { status?: string })
          .filter((s) => s.status !== "pending")
          .sort((a, b) => b.createdAt - a.createdAt);
      } else {
        // Preferred: composite-indexed query with server-side ordering.
        const preferred = query(
          collection(db, "samples"),
          where("kind", "==", kind),
          where("isBuiltIn", "==", true),
          orderBy("name", "asc"),
        );
        try {
          const snap = await getDocs(preferred);
          samples = snap.docs.map((d) => d.data() as SampleRef);
        } catch (indexErr) {
          // Fallback when the composite index isn't built yet (first deploy,
          // or emulator without indexes). Keep both equality filters so the
          // query still matches `samples/{allow read: if resource.data.isBuiltIn == true}`
          // rules — dropping isBuiltIn here causes Firestore to reject the
          // whole query for signed-out users.

          console.warn(
            `[samples] composite index unavailable, falling back to client sort`,
            indexErr,
          );
          const fallback = query(
            collection(db, "samples"),
            where("kind", "==", kind),
            where("isBuiltIn", "==", true),
          );
          const snap = await getDocs(fallback);
          samples = snap.docs
            .map((d) => d.data() as SampleRef)
            .sort((a, b) => a.name.localeCompare(b.name));
        }
      }
      set((s) => ({
        samples: {
          ...s.samples,
          [kind]: { status: "ready", samples, error: null },
        },
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "samples load failed";

      console.error(`[samples] fetch ${kind} failed`, err);
      set((s) => ({
        samples: {
          ...s.samples,
          [kind]: { ...s.samples[kind], status: "error", error: message },
        },
      }));
    }
  },

  resolveSampleUrl: async (sample) => {
    const cacheKey = `${sample.id}:${sample.version}`;
    const cached = get().urlCache[cacheKey];
    if (cached) return cached;
    // Hardwire override for isolating "audio graph" vs "storage fetch" bugs.
    // When set, every track resolves to the same sample so we can confirm
    // the engine can actually play something.
    if (env.audioHardwireUrl) {
      set((s) => ({
        urlCache: { ...s.urlCache, [cacheKey]: env.audioHardwireUrl },
      }));
      return env.audioHardwireUrl;
    }
    // Built-ins live under `samples/builtin/**` which is world-readable
    // per storage.rules — the SDK's getDownloadURL gives us a tokened
    // public URL. User-uploaded customs sit under `samples/users/{uid}/**`
    // which is deny-by-default; reads go through a server-signed v4 URL
    // that's owner-scoped. Cache lifetime matches the server's expiry
    // (10 min); if the cache outlives that we get a 403 on play, which
    // the engine surfaces and we recover via re-resolve next time.
    let url: string;
    if (sample.isBuiltIn) {
      url = await getDownloadURL(storageRef(storage, sample.storagePath));
    } else {
      // Pass the active session id when in a jam — the server uses
      // it to grant participants read access to the host's samples
      // (project-scoped, not user-scoped). Solo / no-session calls
      // skip the field; server falls back to owner-only signing.
      const sessionId = get().collab.session.id;
      const result = await api.post<{ urls: Record<string, string> }>(
        "/samples/download-urls",
        {
          ids: [sample.id],
          ...(sessionId ? { sessionId } : {}),
        },
      );
      const signed = result.urls[sample.id];
      if (!signed) throw new Error(`no download URL for sample ${sample.id}`);
      url = signed;
    }
    set((s) => ({ urlCache: { ...s.urlCache, [cacheKey]: url } }));
    return url;
  },

  addCustomSample: (sample) => {
    set((s) => {
      const kindState = s.samples.custom;
      const filtered = kindState.samples.filter(
        (existing) => existing.id !== sample.id,
      );
      return {
        samples: {
          ...s.samples,
          custom: {
            // First-write puts the kind into "ready" so the SampleRow
            // empty-state doesn't show "loading" after a fresh upload
            // on a session that never called fetchSamples.
            status: "ready",
            samples: [sample, ...filtered],
            error: null,
          },
        },
      };
    });
  },

  removeCustomSample: (id) => {
    set((s) => ({
      samples: {
        ...s.samples,
        custom: {
          ...s.samples.custom,
          samples: s.samples.custom.samples.filter(
            (sample) => sample.id !== id,
          ),
        },
      },
    }));
  },

  resetCustomSamples: () => {
    set((s) => ({
      samples: { ...s.samples, custom: emptyKindState() },
    }));
  },

  findSampleById: (id) => {
    // Lazy memoization: rebuild the id→ref map only when one of the
    // per-kind sample arrays has been replaced (set() always assigns a
    // fresh array, so reference equality on each kind is the cheap
    // truth signal). Render path can hit this 30+ times per frame so
    // a linear scan over ~700 docs adds up; a Map lookup is O(1).
    const samples = get().samples;
    const refs = TRACK_KINDS.map((k) => samples[k].samples);
    const stale = !idMapKey || refs.some((r, i) => r !== idMapKey![i]);
    if (stale) {
      idMapKey = refs;
      idMap = new Map(
        refs.flatMap((arr) => arr.map((s) => [s.id, s] as const)),
      );
    }
    return idMap.get(id);
  },
});

// Module-scoped memo for findSampleById. Lives outside the slice
// closure so a single shared map is reused across the (singleton)
// store rather than being recomputed per-call.
let idMapKey: SampleRef[][] | null = null;
let idMap: Map<string, SampleRef> = new Map();
