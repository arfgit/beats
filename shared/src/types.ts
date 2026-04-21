import type { TRACK_KINDS, EFFECT_KINDS } from "./constants.js";

export type TrackKind = (typeof TRACK_KINDS)[number];
export type EffectKind = (typeof EFFECT_KINDS)[number];
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SampleRef {
  id: string;
  kind: TrackKind;
  name: string;
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

export interface Pattern {
  schemaVersion: number;
  bpm: number;
  masterGain: number;
  stepCount: number;
  tracks: Track[];
  effects: EffectState[];
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  pattern: Pattern;
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
