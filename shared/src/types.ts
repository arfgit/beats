import type { TRACK_KINDS, EFFECT_KINDS } from "./constants.js";

export type TrackKind = (typeof TRACK_KINDS)[number];
export type EffectKind = (typeof EFFECT_KINDS)[number];
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SampleRef {
  id: string;
  kind: TrackKind;
  /** Optional subcategory — drums has kick/snare/clap/hihat/etc. */
  category?: string;
  name: string;
  /** Object path inside the default Storage bucket. */
  storagePath: string;
  version: number;
  durationMs: number;
  isBuiltIn: boolean;
  ownerId?: string;
  createdAt: number;
  deletedAt?: number;
}

export interface TrackStep {
  active: boolean;
  velocity: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  /**
   * Optional user-editable label. Falls back to kind when absent — two
   * drums rows both read as "drums" without this, which is confusing
   * once multiple tracks of the same kind are allowed.
   */
  name?: string;
  sampleId: string | null;
  sampleVersion: number | null;
  gain: number;
  muted: boolean;
  soloed: boolean;
  steps: TrackStep[];
}

export interface EffectState {
  kind: EffectKind;
  enabled: boolean;
  params: Record<string, number>;
}

/**
 * Schema-v1 project body — a single flat pattern with exactly one track
 * per kind. Kept for backwards-compat reads and for the migration path to
 * v2. New writes prefer ProjectMatrix (schemaVersion 2).
 */
export interface Pattern {
  schemaVersion: 1 | number;
  bpm: number;
  masterGain: number;
  stepCount: number;
  tracks: Track[];
  effects: EffectState[];
}

/**
 * Schema-v2 mixer cell body — the tracks + steps for one cell in the
 * matrix. BPM / master gain are hoisted to ProjectMatrix (shared across
 * all cells), and tracks are no longer constrained to one-per-kind —
 * the user picks any TrackKind per slot, duplicates allowed.
 */
export interface MixerPattern {
  stepCount: number;
  tracks: Track[];
}

export interface MixerCell {
  /** Stable id so engine tracks the cell through matrix reorders. */
  id: string;
  enabled: boolean;
  pattern: MixerPattern;
  effects: EffectState[];
}

export interface ProjectMatrix {
  schemaVersion: 2;
  sharedBpm: number;
  masterGain: number;
  /** Row-major 3×3 order. Length always 9. */
  cells: MixerCell[];
}

/**
 * Union of the two pattern shapes. Discriminated on `schemaVersion`.
 * Use `isProjectMatrix(pattern)` to narrow.
 */
export type ProjectPattern = Pattern | ProjectMatrix;

export function isProjectMatrix(p: ProjectPattern): p is ProjectMatrix {
  return (p as ProjectMatrix).schemaVersion === 2;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  pattern: ProjectPattern;
  isPublic: boolean;
  collaboratorIds: string[];
  updatedAt: number;
  revision: number;
  thumbnailUrl?: string;
  createdAt: number;
}

export interface UploadedTrack {
  id: string;
  ownerId: string;
  projectId: string | null;
  title: string;
  storagePath: string;
  durationMs: number;
  createdAt: number;
}

export interface SocialLink {
  kind: string;
  url: string;
}

export interface User {
  id: string;
  displayName: string;
  email: string;
  photoUrl: string | null;
  bio: string;
  socialLinks: SocialLink[];
  role: "user" | "admin";
  isPublic: boolean;
  createdAt: number;
}

export type ApiErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL"
  | "RATE_LIMITED";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
}

export type ApiResponse<T> = { data: T } | { error: ApiError };
