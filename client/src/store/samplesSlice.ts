import type { StateCreator } from "zustand";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import type { SampleRef, TrackKind } from "@beats/shared";
import { TRACK_KINDS } from "@beats/shared";
import { db, storage } from "@/lib/firebase";
import { env } from "@/lib/env";
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
    set((s) => ({
      samples: {
        ...s.samples,
        [kind]: { ...s.samples[kind], status: "loading" },
      },
    }));
    try {
      // Preferred: composite-indexed query with server-side ordering.
      const preferred = query(
        collection(db, "samples"),
        where("kind", "==", kind),
        where("isBuiltIn", "==", true),
        orderBy("name", "asc"),
      );
      let samples: SampleRef[];
      try {
        const snap = await getDocs(preferred);
        samples = snap.docs.map((d) => d.data() as SampleRef);
      } catch (indexErr) {
        // Fallback when the composite index isn't built yet (first deploy,
        // or emulator without indexes). Keep both equality filters so the
        // query still matches `samples/{allow read: if resource.data.isBuiltIn == true}`
        // rules — dropping isBuiltIn here causes Firestore to reject the
        // whole query for signed-out users.
        // eslint-disable-next-line no-console
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
      set((s) => ({
        samples: {
          ...s.samples,
          [kind]: { status: "ready", samples, error: null },
        },
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "samples load failed";
      // eslint-disable-next-line no-console
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
    const url = env.audioHardwireUrl
      ? env.audioHardwireUrl
      : await getDownloadURL(storageRef(storage, sample.storagePath));
    set((s) => ({ urlCache: { ...s.urlCache, [cacheKey]: url } }));
    return url;
  },

  findSampleById: (id) => {
    const all = Object.values(get().samples).flatMap((k) => k.samples);
    return all.find((s) => s.id === id);
  },
});
