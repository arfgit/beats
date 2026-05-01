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
  /**
   * Original filename a user picked when uploading a custom sample.
   * Display-only — storagePath is server-generated (`samples/users/{uid}/{id}.wav`)
   * and never reflects the user-supplied name. Sanitized at promote time.
   */
  sourceFileName?: string;
  /** Encoded WAV size of a custom sample's storage object, in bytes. */
  originalSizeBytes?: number;
  /**
   * Project this custom sample is rigged to. Samples are scoped to a
   * project — uploading for project A never bleeds into project B.
   * Built-ins have no projectId (they're available to every project).
   * On fork, the server clones each parent project's sample docs and
   * stamps the new copies with the fork's projectId so the fork's rig
   * is pre-loaded at fork time.
   */
  projectId?: string;
}

export interface TrackStep {
  active: boolean;
  velocity: number;
  /**
   * Per-step sample override snapshotted from `track.sampleId` at toggle
   * time. Swapping the row's sample mid-composition no longer rewrites
   * existing active steps — each step remembers the sample that was
   * selected when it was placed. Absent fields fall back to the track's
   * current sample (legacy / just-placed behavior).
   */
  sampleId?: string | null;
  sampleVersion?: number | null;
  /**
   * Snapshot of `SampleRef.name` at the moment the step was activated or
   * the sample was replaced. Render path prefers this so labels paint
   * before the samples library hydrates and don't retroactively change
   * when a user renames a sample. Optional for backwards compat with
   * pre-refactor docs; render falls back to a live id lookup.
   */
  sampleName?: string | null;
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
  /**
   * Snapshot of the track's currently-selected sample name. Mirror of
   * `TrackStep.sampleName` at the row level — used as the secondary
   * fallback in the label chain (step.sampleName ?? track.sampleName ??
   * lookup). Optional + nullable for backwards compat.
   */
  sampleName?: string | null;
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

// MixerCell and below carry an optional user-editable name so users can
// label cells ("intro", "drop", "outro"). See MixerCell.name below.

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
  /** Optional user-editable label — falls back to the 1-based index when absent. */
  name?: string;
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

export type AuthProvider = "google.com" | "password";

export interface User {
  id: string;
  schemaVersion?: 2;
  displayName: string;
  /**
   * Public handle, lowercase canonical form per USERNAME_REGEX. Empty
   * string when the user hasn't claimed one yet — the auth slice maps
   * that to `status: "needsUsername"` and the app shell renders the
   * onboarding takeover until claimed.
   */
  username: string;
  /** Lowercase mirror used for `usernames/{usernameLower}` reservation lookups. */
  usernameLower: string;
  email: string;
  emailVerified: boolean;
  /** Sign-in providers seen for this account. Multi-element once linking ships. */
  authProviders: AuthProvider[];
  photoUrl: string | null;
  bio: string;
  socialLinks: SocialLink[];
  role: "user" | "admin";
  isPublic: boolean;
  createdAt: number;
  buddyCode?: string;
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
