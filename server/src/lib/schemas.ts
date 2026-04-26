import { z } from "zod";
import {
  BPM_MAX,
  BPM_MIN,
  EFFECT_KINDS,
  STEP_COUNT,
  TRACK_KINDS,
  TRACKS_PER_CELL,
  validateDisplayName,
} from "@beats/shared";

const trackStepSchema = z.object({
  active: z.boolean(),
  velocity: z.number().min(0).max(1),
  // Per-step sample override (captured at toggle-on time so the grid
  // glyph + playback stays stable when the row's sample dropdown
  // changes). Optional + nullable for backwards compat with legacy
  // docs that never had these fields.
  sampleId: z.string().nullable().optional(),
  sampleVersion: z.number().int().nullable().optional(),
  // Display-name snapshot pinned at activation/replace time. Render
  // prefers this over a live samples-collection lookup so labels paint
  // before hydration and don't retroactively change on rename. 120-char
  // ceiling matches the project title cap.
  sampleName: z.string().max(120).nullable().optional(),
});

const trackSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(TRACK_KINDS),
  // User-editable row label (40-char cap mirrors patternSlice trimming).
  name: z.string().max(40).optional(),
  sampleId: z.string().nullable(),
  sampleVersion: z.number().int().nullable(),
  // Track-level sample-name snapshot — secondary fallback in the render
  // label chain after the per-step snapshot.
  sampleName: z.string().max(120).nullable().optional(),
  gain: z.number().min(0).max(1),
  muted: z.boolean(),
  soloed: z.boolean(),
  steps: z.array(trackStepSchema).length(STEP_COUNT),
});

const effectSchema = z.object({
  kind: z.enum(EFFECT_KINDS),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
});

/**
 * Legacy v1 pattern — a single pattern with exactly one track per kind.
 * Kept for backwards-compat: old clients keep writing this shape until
 * they upgrade, and old projects in Firestore keep reading through the
 * same validators.
 */
export const legacyPatternSchema = z.object({
  schemaVersion: z.literal(1),
  bpm: z.number().int().min(BPM_MIN).max(BPM_MAX),
  masterGain: z.number().min(0).max(1),
  stepCount: z.literal(STEP_COUNT),
  tracks: z.array(trackSchema).length(TRACKS_PER_CELL),
  effects: z.array(effectSchema).length(EFFECT_KINDS.length),
});

// v2 mixer cell — track kinds per slot are user-chosen, duplicates allowed.
// Cell track ids only need to be unique WITHIN a cell; across cells the
// engine namespaces them by `{cellId}:{trackId}`. `TRACK_KINDS.length`
// (4 tracks per cell) is still enforced because the UI is 4-row.
const matrixTrackSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(TRACK_KINDS),
  // User-editable row label (40-char cap mirrors patternSlice trimming).
  name: z.string().max(40).optional(),
  sampleId: z.string().nullable(),
  sampleVersion: z.number().int().nullable(),
  // Track-level sample-name snapshot — see trackStepSchema.sampleName.
  sampleName: z.string().max(120).nullable().optional(),
  gain: z.number().min(0).max(1),
  muted: z.boolean(),
  soloed: z.boolean(),
  steps: z.array(trackStepSchema).length(STEP_COUNT),
});

const mixerPatternSchema = z.object({
  stepCount: z.literal(STEP_COUNT),
  tracks: z.array(matrixTrackSchema).length(TRACKS_PER_CELL),
});

const mixerCellSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean(),
  pattern: mixerPatternSchema,
  effects: z.array(effectSchema).length(EFFECT_KINDS.length),
});

// 9 cells, row-major. Uniqueness of cell + track ids is enforced in the
// outer union refinement so `matrixPatternSchema` stays a plain ZodObject
// — a requirement for `z.discriminatedUnion` to accept it.
export const matrixPatternSchema = z.object({
  schemaVersion: z.literal(2),
  sharedBpm: z.number().int().min(BPM_MIN).max(BPM_MAX),
  masterGain: z.number().min(0).max(1),
  cells: z.array(mixerCellSchema).length(9),
});

/**
 * Dual-accept union on `schemaVersion`. Writes during the migration
 * window can carry either shape; reads canonicalize at the application
 * layer (see `isProjectMatrix` in @beats/shared). Matrix-specific id
 * uniqueness is enforced via the outer refinement below.
 */
export const patternSchema = z
  .discriminatedUnion("schemaVersion", [
    legacyPatternSchema,
    matrixPatternSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.schemaVersion !== 2) return;
    const cellIds = new Set<string>();
    for (let i = 0; i < val.cells.length; i++) {
      const id = val.cells[i]!.id;
      if (cellIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cells", i, "id"],
          message: `duplicate cell id: ${id}`,
        });
      }
      cellIds.add(id);
      const trackIds = new Set<string>();
      for (let j = 0; j < val.cells[i]!.pattern.tracks.length; j++) {
        const tid = val.cells[i]!.pattern.tracks[j]!.id;
        if (trackIds.has(tid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cells", i, "pattern", "tracks", j, "id"],
            message: `duplicate track id within cell ${id}: ${tid}`,
          });
        }
        trackIds.add(tid);
      }
    }
  });

export const createProjectBody = z.object({
  title: z.string().min(1).max(120),
  pattern: patternSchema,
  isPublic: z.boolean().default(false),
});

export const updateProjectBody = z.object({
  title: z.string().min(1).max(120).optional(),
  pattern: patternSchema.optional(),
  isPublic: z.boolean().optional(),
});

export const inviteBody = z.object({
  email: z.string().email(),
});

export const uploadUrlBody = z.object({
  title: z.string().min(1).max(120),
  durationMs: z.number().int().min(0),
  projectId: z.string().nullable().optional(),
  contentType: z
    .enum(["audio/wav", "audio/mpeg", "audio/webm", "audio/mp4"])
    .default("audio/wav"),
});

// Finalize reads storagePath from the server-owned uploadedTracks doc,
// so the client sends no body — just the track id on the URL.
export const finalizeTrackBody = z.object({}).strict();

// Custom-sample upload. Returns a v4 signed PUT URL the client uses to
// stream the trimmed WAV directly to GCS. Server creates a pending
// `samples/{id}` doc up front so quota accounting + cleanup are
// transactional with the URL issuance.
export const sampleUploadUrlBody = z.object({
  name: z.string().min(1).max(120),
  durationMs: z.number().int().min(100).max(15_000),
  sourceFileName: z.string().max(200).optional(),
});

// Finalize reads storagePath from the server-owned samples doc, so the
// client sends nothing — server verifies object metadata + flips status.
export const sampleFinalizeBody = z.object({}).strict();

// Batched download URL request — keeps round trips bounded when a
// project loads N custom samples on hydration.
export const sampleDownloadUrlsBody = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(50),
});

// Collab session create — body carries the projectId the session will
// mirror; the server reads the project doc to verify ownership and
// to seed RTDB state with the canonical pattern.
export const createSessionBody = z.object({
  projectId: z.string().min(1).max(64),
});

// Join / leave / end carry no body — the session id lives on the URL,
// the server reads everything else from Firestore + RTDB.
export const sessionEmptyBody = z.object({}).strict();

export const updateUserBody = z.object({
  displayName: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .refine(
      (val) => val === undefined || validateDisplayName(val).valid,
      (val) => ({
        message:
          val !== undefined
            ? (validateDisplayName(val).reason ?? "invalid display name")
            : "invalid display name",
      }),
    ),
  bio: z.string().max(500).optional(),
  socialLinks: z
    .array(
      z.object({
        kind: z.string().min(1).max(32),
        url: z.string().url(),
      }),
    )
    .max(10)
    .optional(),
  photoUrl: z.string().url().nullable().optional(),
  isPublic: z.boolean().optional(),
});
