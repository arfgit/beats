import { z } from "zod";
import {
  BPM_MAX,
  BPM_MIN,
  EFFECT_KINDS,
  STEP_COUNT,
  TRACK_KINDS,
} from "@beats/shared";

const trackStepSchema = z.object({
  active: z.boolean(),
  velocity: z.number().min(0).max(1),
});

const trackSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(TRACK_KINDS),
  sampleId: z.string().nullable(),
  sampleVersion: z.number().int().nullable(),
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

export const patternSchema = z.object({
  schemaVersion: z.number().int().min(1),
  bpm: z.number().int().min(BPM_MIN).max(BPM_MAX),
  masterGain: z.number().min(0).max(1),
  stepCount: z.literal(STEP_COUNT),
  tracks: z.array(trackSchema).length(TRACK_KINDS.length),
  effects: z.array(effectSchema).length(EFFECT_KINDS.length),
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
    .enum(["audio/wav", "audio/mpeg", "audio/webm"])
    .default("audio/wav"),
});

export const finalizeTrackBody = z.object({
  storagePath: z.string().min(1),
});

export const updateUserBody = z.object({
  displayName: z.string().min(1).max(80).optional(),
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
