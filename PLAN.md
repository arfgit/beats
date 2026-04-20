# beats — Architecture Plan

Greenfield rewrite of a legacy Next.js beat sequencer as a collaborative, neon-synthwave studio web app. Audio engine built fresh on Tone.js.

## Decisions (locked)

| Area | Choice |
|------|--------|
| Migration philosophy | Greenfield rewrite — legacy repo treated as behavior spec, not code spec |
| Language | TypeScript, strict mode |
| Frontend stack | Vite + React 19 + Tailwind CSS v4 + Zustand + React Router v7 |
| Audio | Tone.js directly (no wrappers, no `setTimeout`-based scheduler) |
| UI components | Hand-rolled, no component library |
| Aesthetic | Neon retro synthwave (see palette in §4) |
| Backend | Express BFF for writes + privileged ops; direct Firestore client SDK for reads of own/public data (see §3 for rationale) |
| Database | Firestore |
| File storage | Firebase Storage via V4 signed URLs (client uploads direct) |
| Auth | Firebase Auth (Google provider) |
| Monorepo layout | `client/` / `server/` / `shared/` — workspaces |
| Firebase project (dev) | `beats-dev-ant` (display name "beats-dev") |

---

## 1. Directory layout

```
~/Projects/beats/
├── PLAN.md                         # this file
├── README.md
├── package.json                    # workspaces root
├── firebase.json                   # hosting + functions + rules + storage + emulators
├── firestore.rules                 # scoped rules — see §3
├── firestore.indexes.json
├── storage.rules
├── cors.json
├── .firebaserc                     # default project: beats-dev-ant
├── client/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       ├── audio/                  # Tone.js engine — see §5
│       ├── features/               # studio, gallery, profile, admin, auth, collab
│       ├── components/ui/          # hand-rolled primitives + tooltip
│       ├── store/                  # Zustand slices — see §6
│       ├── lib/                    # api client, firebase client, migrations, command-history
│       ├── workers/                # WAV encoder web worker
│       ├── data/                   # static sample manifest, effect presets
│       └── styles/
│           ├── tokens.css          # synthwave palette — see §4
│           └── globals.css
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                # local dev entry (tsx watch)
│       ├── functions.ts            # Firebase Functions export
│       ├── app.ts                  # Express factory
│       ├── routes/
│       ├── services/
│       ├── lib/                    # auth middleware, zod schemas, request-id, pino logger
│       └── .data/                  # gitignored local-dev JSON fallback
└── shared/
    ├── package.json
    ├── tsconfig.json
    ├── index.ts
    ├── types.ts
    ├── migrations.ts               # Pattern schema migrators
    └── constants.ts                # BPM_MIN/MAX, STEP_COUNT, SCHEMA_VERSION
```

---

## 2. Shared types (authoritative, consumed via `@beats/shared`)

```ts
// shared/constants.ts
export const SCHEMA_VERSION = 1;
export const STEP_COUNT = 8;
export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const MAX_RECORDING_MS = 120_000;          // 2 min cap — mobile Safari memory ceiling
export const TRACK_KINDS = ["drums", "bass", "guitar", "vocals"] as const;
export const EFFECT_KINDS = ["chorus", "phaser", "tremolo", "moogFilter"] as const;

// shared/types.ts
export type TrackKind  = typeof TRACK_KINDS[number];
export type EffectKind = typeof EFFECT_KINDS[number];
export type StepIndex  = 0|1|2|3|4|5|6|7;

export interface SampleRef {
  id: string;
  kind: TrackKind;
  name: string;
  storagePath: string;              // gs://... — canonical; downloadUrl computed on demand
  version: number;                  // immutable versioning — old projects pin to old versions
  durationMs: number;
  isBuiltIn: boolean;
  ownerId?: string;
  createdAt: number;
  deletedAt?: number;               // tombstone — deletion never removes the doc
}

export interface TrackStep { active: boolean; velocity: number; }

export interface Track {
  id: string;
  kind: TrackKind;
  sampleId: string | null;
  sampleVersion: number | null;     // pinned at assignment time
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
  schemaVersion: number;            // gates migration on load
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
  revision: number;                 // optimistic concurrency counter
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

export interface User {
  id: string;
  displayName: string;
  email: string;
  photoUrl: string | null;
  bio: string;
  socialLinks: { kind: string; url: string }[];
  role: "user" | "admin";
  createdAt: number;
}

export interface ApiError {
  code: "VALIDATION" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "INTERNAL" | "RATE_LIMITED";
  message: string;
  details?: unknown;
  requestId: string;                // correlates with server logs
}
```

---

## 3. Backend architecture — BFF split-read pattern

**Design note.** Routing every read through Express adds 50–200ms warm latency and 1–3s cold starts on Cloud Functions — unacceptable for studio UX and incompatible with real-time collaboration via `onSnapshot`. The split below keeps writes centralized (security, validation, rate-limiting) while letting reads hit Firestore directly through scoped security rules.

**Writes (BFF required):** creation, updates, deletes, invites, uploads. All go through `POST/PATCH/DELETE /api/*`, validated with Zod, authenticated via Firebase ID token, rate-limited.

**Reads (direct Firestore client SDK with scoped rules):**
- Own projects: `where("ownerId", "==", request.auth.uid)`
- Public gallery: `where("isPublic", "==", true)`
- Shared with me: `where("collaboratorIds", "array-contains", request.auth.uid)`
- Own uploaded tracks: `where("ownerId", "==", request.auth.uid)`
- Public profile tracks: only when user profile `isPublic: true`
- Built-in samples: public read (cached via Firebase Hosting CDN as static JSON to absorb unauthenticated load)

**Real-time:** `onSnapshot` listeners on project doc and presence subcollection — required for Phase 5 collaboration.

### Firestore security rules sketch

```
match /projects/{projectId} {
  allow read: if request.auth != null
              && (resource.data.ownerId == request.auth.uid
                  || resource.data.isPublic == true
                  || request.auth.uid in resource.data.collaboratorIds);
  allow write: if false;                                   // all writes via BFF
}
match /projects/{projectId}/presence/{uid} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && uid == request.auth.uid;
}
match /uploadedTracks/{id} {
  allow read: if request.auth != null
              && (resource.data.ownerId == request.auth.uid
                  || get(/databases/$(database)/documents/users/$(resource.data.ownerId)).data.isPublic == true);
  allow write: if false;
}
match /samples/{id} {
  allow read: if resource.data.isBuiltIn == true
              || (request.auth != null && resource.data.ownerId == request.auth.uid);
  allow write: if false;
}
match /users/{uid} { allow read: if request.auth != null; allow write: if false; }
match /invites/{id} { allow read, write: if false; }
```

### Express BFF routes (writes + privileged reads)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/session` | Create `users/{uid}` on first login |
| GET  | `/api/auth/me` | Current user |
| POST | `/api/auth/signout` | Invalidate server session refs |
| POST | `/api/projects` | Create project (validated Pattern) |
| PATCH | `/api/projects/:id` | Update with `If-Match: revision` → 409 on conflict |
| DELETE | `/api/projects/:id` | Owner only |
| POST | `/api/projects/:id/fork` | Clone into caller |
| POST | `/api/projects/:id/collaborators` | Invite by email |
| DELETE | `/api/projects/:id/collaborators/:uid` | Remove |
| POST | `/api/tracks/upload-url` | Signed PUT URL + pending doc |
| POST | `/api/tracks/:id/finalize` | Verify object, flip status |
| DELETE | `/api/tracks/:id` | Owner only |
| POST | `/api/samples` | User sample upload (signed URL flow) |
| DELETE | `/api/samples/:id` | Tombstone + bump `deletedAt` |
| GET | `/api/samples/:id/resolve-url` | Signed GET URL with in-memory LRU cache |
| PATCH | `/api/users/me` | Update profile |
| GET/PATCH/DELETE | `/api/admin/*` | Admin role custom claim required |

**Middleware stack:** request-id → pino structured logger → CORS → bearer auth → rate limit (per-uid token bucket) → zod validation → handler.

**Response envelope:** `{ data: T }` on success, `{ error: ApiError }` on failure. Every response carries `x-request-id`.

---

## 4. Design tokens — neon synthwave

```css
/* client/src/styles/tokens.css */
:root {
  /* backgrounds */
  --bg-void:      #0a0518;  /* outside panels, page letterbox */
  --bg-space:     #13082e;  /* main app background */
  --bg-panel:     #1c0f3f;  /* cards, modals, elevated surfaces */
  --bg-panel-2:   #2a1657;  /* hover / active surfaces */

  /* ink */
  --ink:          #f2eaff;  /* primary text */
  --ink-dim:      #b8a3e8;  /* secondary */
  --ink-muted:    #7c6aa8;  /* placeholder / tertiary */

  /* structure */
  --grid:         #3a2670;  /* dividers, grid lines, subtle borders */

  /* neon accents */
  --neon-magenta: #ff2a6d;  /* primary — active step, CTA */
  --neon-cyan:    #05d9e8;  /* secondary — collab cursor, info */
  --neon-violet:  #b84dff;  /* tertiary — playhead, focus ring */
  --neon-sun:     #ffb800;  /* warning, highlight */
  --neon-green:   #39ff14;  /* success, record indicator */
  --neon-red:     #ff3864;  /* danger, destructive */

  /* glows — use sparingly on active states */
  --glow-magenta: 0 0 12px rgba(255, 42, 109, 0.6);
  --glow-cyan:    0 0 12px rgba(5, 217, 232, 0.55);
  --glow-violet:  0 0 10px rgba(184, 77, 255, 0.5);

  /* focus ring */
  --focus-ring:   0 0 0 2px var(--neon-violet), 0 0 10px rgba(184, 77, 255, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --glow-magenta: none;
    --glow-cyan: none;
    --glow-violet: none;
  }
}
```

Typography: JetBrains Mono for body; optional display font (Monoton / Press Start 2P) reserved for logo lockup only.

---

## 5. Audio engine

Lives at `client/src/audio/`. The most technically sensitive piece of the app.

### Module layout

- `engine.ts` — singleton owning the graph and public API
- `context.ts` — lazy `Tone.start()`, visibility handling
- `samplePool.ts` — decode-once `AudioBuffer` cache keyed by `(sampleId, version)`
- `players.ts` — per-track `Tone.Player` lifecycle, hot-swap on sample change
- `effects.ts` — master-bus chain with proper bypass semantics
- `transport.ts` — `Tone.Sequence` at `8n`, scheduled-time step callback
- `recorder.ts` — `MediaRecorder` tap + worker-based WAV encode
- `snapshot.ts` — immutable engine-side mirror of pattern state
- `bridge.ts` — subscribes to `patternSlice`, diffs into engine setters + snapshot
- `subscribers.ts` — external observable for playhead/step

### Signal graph

```
drums.Player  ─► drums.Gain  ─┐
bass.Player   ─► bass.Gain   ─┤
guitar.Player ─► guitar.Gain ─┼─► busGain ─► fxBus ─► masterGain ─┬─► Destination
vocals.Player ─► vocals.Gain ─┘                                  └─► recordTap (Gain) ─► MediaStreamDest ─► MediaRecorder

fxBus detail:
  busGain ─► Chorus ─► Phaser ─► Tremolo ─► [MoogBypass] ─► masterGain
                                            ├─ dry ─► crossFade.out
                                            └─ Filter ─► crossFade.out
```

### Key engine contracts

1. **Scheduled-time triggers.** Every `Player.start(time, offset, undefined, undefined, velocity)` call inside the step callback uses the `time` arg from the Tone scheduler. No `"+0"`, no un-timed triggers — an ESLint rule enforces this pattern in `audio/`. Missing this turns lookahead scheduling into main-thread jitter.

2. **Engine snapshot.** `bridge.ts` subscribes to `patternSlice` and commits changes into a plain JS `EnginePatternSnapshot` object held by the engine. The step callback reads only from the snapshot — never `useBeatsStore.getState()`. Snapshot swaps are atomic per bar boundary; mid-bar edits to timing-sensitive fields (BPM, step shape) queue until the next downbeat.

3. **Moog true-bypass.** `Tone.Filter` has no `wet` parameter, so the "set wet=0 to bypass" trick doesn't work for the Moog — it would still color the signal. A `Tone.CrossFade` splits dry and filter paths; `fade.fade.rampTo(enabled ? 1 : 0, 0.02)` on toggle. Other three effects keep their native `wet` param (they're real wet/dry effects).

4. **Recording.** Max duration enforced at `MAX_RECORDING_MS = 120_000`. UI shows a countdown; warning toast at 90s. WAV encoding runs in a Web Worker (`client/src/workers/wav-encoder.ts`) with chunked streaming to avoid blocking the main thread and to stay under mobile Safari's ~200 MB transient-memory ceiling. Safari falls back to `audio/mp4` + AAC with codec-aware decode.

5. **Visibility handling.** `visibilitychange` listener pauses `Tone.Transport` immediately when the tab hides — unless recording is active — and resumes + resyncs step index on return. No arbitrary threshold.

6. **Playhead subscription.** `currentStep` is NOT in Zustand. Engine exposes `audioEngine.subscribe("step", cb)`; components use `useSyncExternalStore` with rAF coalescing. Zero store churn per tick, even at high BPM or 32-step patterns later.

### Public API

```ts
audioEngine.ensureStarted(): Promise<void>;
audioEngine.play(): Promise<void>;                    // captures snapshot atomically
audioEngine.stop(): void;
audioEngine.startRecording(): Promise<void>;
audioEngine.stopRecording(): Promise<Blob>;           // WAV blob from worker
audioEngine.subscribe(event: "step" | "rec", cb): () => void;
audioEngine.reset(): void;                            // sign-out cleanup
```

---

## 6. Zustand store

Single `useBeatsStore` composed from slice factories. Mutations via Immer `produce` with inverse-patches for undo.

- **`authSlice`** — user, idToken, status; `bootFromFirebase`, `signInWithGoogle`, `signOut` (calls `audioEngine.reset()`), `refreshToken`.
- **`patternSlice`** — hot path, all mutations go through `commandHistory`: `toggleStep`, `setVelocity`, `setTrackSample`, `setGain`, `mute/solo`, `setBpm`, `setEffectParam`, `toggleEffect`. Narrow selectors.
- **`commandHistorySlice`** — `past`, `future` arrays of Immer patch-pairs. `undo()`, `redo()`. Keybindings in Studio shell.
- **`projectSlice`** — currentProject, dirty, saveStatus (idle / saving / conflict / error); `load`, `save` (debounced 800ms), `fork`, `invite`. Persists dirty state to IndexedDB for offline.
- **`transportSlice`** — `isPlaying`, `isRecording`, `audioReady` only. `currentStep` lives in the engine's external subscription, not the store. Actions delegate to the engine singleton.
- **`samplesSlice`** — `byKind`, `loading`, signed-URL LRU cache.
- **`collabSlice`** — `peers: Record<uid, PresenceState>`, `isTransportOwner` (via BroadcastChannel lock between tabs), `conflictState`.
- **`uiSlice`** — activePanel, toast, modal, sidebarOpen, tooltipEnabled.
- **`gallerySlice`** / **`profileSlice`** — lazy cursor lists.

---

## 7. Component inventory (~28, hand-rolled)

**Primitives (`components/ui/`):** Button, IconButton, Slider, Knob, Dialog, Drawer, Toast, Tooltip, Avatar, TextField, TextArea, ErrorBoundary, Skeleton.

**Studio (`features/studio/`):** TransportBar, StepGrid (4×8 roving focus), TrackRow, SoundMenu, EffectsRack, EffectCard (with bypass switch), RecorderPanel, SaveShareBar, Playhead, CollabCursor.

**Social (`features/gallery/`, `profile/`):** GalleryGrid, ProjectCard, UserProfileHeader, TrackList, SignInButton, InviteDialog, ForkButton.

**Admin (`features/admin/`):** AdminTable.

All interactive elements: visible `:focus-visible` ring using `--focus-ring`, aria-labels for icon-only, keyboard operable, reduced-motion respect. Tooltips enabled by default on all mixer controls.

---

## 8. Implementation phases (8 total)

Every phase ends in a shippable slice — no dev-only harness milestones.

### Phase 1 — Scaffold + auth
**Goal:** monorepo bootstrapped, routing shell, Google sign-in end-to-end, Firebase emulators wired.
**Deliverables:** workspaces, Vite + Tailwind v4 + tokens.css, Express `/api/health` + `/api/auth/session`, routing (Studio / Gallery / Profile / Admin / Auth), `authSlice`, Tooltip primitive, ErrorBoundary, pino logger + request-id middleware, `.firebaserc` → `beats-dev-ant`.
**Verification:** `npm run dev` → blank synthwave-themed studio loads, sign in, `/api/auth/me` returns user.

### Phase 2a — Audio engine core
**Goal:** engine module with graph, snapshot, scheduled transport, all engine contracts from §5 enforced.
**Deliverables:** `audio/*` modules, unit tests for snapshot swap, WAV encoder worker, Moog cross-fade bypass, sample pool, `audioEngine.play/stop/subscribe`.
**Verification:** vitest suite green; `audioEngine` driven from a test harness reliably triggers samples in Chrome + Safari.

### Phase 2b — Minimal studio shell
**Goal:** 1 track, 1 sample, 1 effect, play/stop — proves the bridge and render path.
**Deliverables:** Studio route renders TransportBar + single TrackRow + single EffectCard; bridge.ts wires patternSlice ↔ engine; built-in samples loaded from Firestore.
**Verification:** Click play, hear the sample loop. Tooltip on every control.

### Phase 3 — Full editor + undo/redo + tooltips
**Goal:** complete pattern editor, recording, Cmd+Z history.
**Deliverables:** 4-track StepGrid with keyboard roving focus, mute/solo/gain, full EffectsRack with all 4 effects + bypass UI, RecorderPanel with 2-min cap + 90s warning, SaveShareBar (local download only this phase), command-history undo/redo, tooltips exhaustive.
**Verification:** user builds a pattern, engages effects audibly, records 2-min WAV, downloads it.

### Phase 4 — Persistence + migrations + offline
**Goal:** projects save, load, round-trip across sessions; offline queueing; multi-tab safety.
**Deliverables:** `POST/PATCH/DELETE /api/projects`, Firestore security rules deployed, direct `onSnapshot` reads for current project, `lib/migrations.ts` with v1 migrator, IndexedDB queue via `idb-keyval`, BroadcastChannel multi-tab lock, sample version pinning + missing-sample UX, `If-Match: revision` optimistic concurrency.
**Verification:** save → reload → same state. Close tab mid-edit → reopen → draft restored. Open same project in 2 tabs → second shows read-only banner.

### Phase 5 — Real-time collaboration
**Goal:** two users co-edit a project live.
**Deliverables:** `onSnapshot` listener on project doc applies remote patches, `projects/{id}/presence/{uid}` writes caller's cursor/selection, CollabCursor component renders peers, `POST /api/projects/:id/collaborators` invite-by-email flow, conflict resolution = field-level last-write-wins with revision-bump.
**Verification:** two browser accounts editing the same project see each other's step toggles, BPM changes, and cursor positions within 500ms.

### Phase 6 — Gallery + profile + social
**Goal:** discovery, forking, public tracks feed.
**Deliverables:** GalleryGrid route, `GET /api/projects?owner=public`, ProjectCard with fork counter, `POST /api/projects/:id/fork`, UserProfileHeader, TrackList, public tracks feed.
**Verification:** browse gallery → fork a project → edit fork → re-share.

### Phase 7 — Mobile-native + PWA
**Goal:** installable app with offline sample cache, touch-first studio layout.
**Deliverables:** responsive StepGrid (collapsed rack, swipeable tracks, bottom transport), Web App Manifest with synthwave icon set, Workbox service worker caching built-in samples + app shell, install prompt handling.
**Verification:** install to iOS/Android home screen → open offline → studio loads with cached samples → can build patterns offline; sync on reconnect.

### Phase 8 — Analytics + observability + admin + polish + a11y
**Goal:** ship-ready.
**Deliverables:** PostHog (or Plausible) event instrumentation (sign-in, create-project, play, record, fork, share), server pino logs shipped to Google Cloud Logging, admin UI routes + actions, focus audit pass, reduced-motion coverage, project thumbnail auto-capture (html-to-image), route-level error boundaries, security pass.
**Verification:** Lighthouse a11y ≥95, security audit zero high-severity, event funnel visible end-to-end.

---

## 9. Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Tone.Transport drift on Safari when backgrounded | `visibilitychange` pause unless recording; resync on return |
| 2 | AudioContext lazy-init lag on first Play | `ensureStarted()` on first pointerdown in Studio shell |
| 3 | Worker WAV encode OOM at edge of 2-min cap on iOS | Worker uses streaming encode (chunked ArrayBuffers); hard cap at 120s |
| 4 | Stale signed URLs after 24h session | Re-request via `/api/samples/:id/resolve-url` on decode failure; retry once |
| 5 | MediaRecorder codec variance | Feature-detect → `audio/webm` or `audio/mp4` w/ AAC; WAV converter branches on mimeType |
| 6 | Firestore doc bloat if step count grows to 32 | `projects/{id}/revisions/` subcollection reserved in rules |
| 7 | Cloud Functions cold start on first API call | `min-instances: 1` in prod; reads bypass BFF entirely |
| 8 | Realtime listener noise during auto-save storm | Debounce save at 800ms; coalesce patches per bar |
| 9 | Multi-tab transport collision | BroadcastChannel lock; second tab gets read-only banner |
| 10 | User uploads malicious audio | Server-side magic-byte check on finalize; size cap |
| 11 | Sample deletion breaks old projects | Tombstone + version pin; load-time missing-sample UX offers replacement |

---

## 10. Deferred / explicitly out of scope

- Collaborative freeform text lanes (lyrics, notes) — would warrant a CRDT layer
- MIDI device input
- Stem export (only master WAV in v1)
- Piano-roll / melodic sequencing
- Generative pattern assistance
- Social graph (follow, likes) — only fork counter in Phase 6
- Payments / paid tiers

---

## 11. Working agreements

- Commits: Conventional Commits format, lowercase subject including acronyms, no tool attribution of any kind
- Solo project — no PR workflow; commit directly to `main` after local verification
- Never push unless explicitly asked
- Dev Firebase project: `beats-dev-ant` (alias `default`); prod project TBD
- Before any phase-boundary commit: `npm run typecheck && npm run lint && npm run test`
