# beats

Collaborative neon-synthwave beat sequencer. Updated, ground-up rewrite of [FC-TEAM-VISA/beatdriver](https://github.com/FC-TEAM-VISA/beatdriver) with a live 3×3 **mixer matrix**, expanded sample library, real-time recording, and a modern Vite/React + Firebase stack.

**🎛️ Live: https://beats-prod-ant.web.app**

---

## What's new vs. the original beatdriver

The original [beatdriver](https://github.com/FC-TEAM-VISA/beatdriver) was a single-pattern Next.js beat sequencer. This rewrite treats the old repo as a behavior spec and rebuilds on a modern stack with a bigger feature surface.

### Stack migration

| | Original (beatdriver) | This rewrite |
|---|---|---|
| Framework | Next.js (pages router) | Vite + React 19 + React Router v7 |
| Language | JavaScript | TypeScript strict mode |
| State | Component-local / props | Zustand with sliced store + Immer patch-based undo |
| Audio | `setTimeout` scheduler | Tone.js directly — `Tone.Sequence` + `Tone.Transport` |
| Styling | Legacy CSS | Tailwind CSS v4 with neon synthwave palette |
| Backend | Next.js API routes | Express BFF (Firebase Cloud Functions v2) |
| Database | — | Firestore, dual-accept schema validator for migration windows |
| Auth | — | Firebase Auth (Google OAuth) |
| Hosting | — | Firebase Hosting + Cloud Run (Functions v2) |

### Feature additions

- **3×3 universal mixer matrix** — nine independent mixer cells, each with its own tracks, effects, and enable toggle. Universal Play advances row-major through enabled cells at bar boundaries with beat-synced handoff. Reorder cells by drag, reorder rows within a cell by drag or keyboard.
- **Rotating demo beats** — "seed demo ✨" cycles through three pre-programmed 9-cell arrangements (Neon Pulse at 108 bpm, Four on the Floor at 124 bpm, Lo-Fi Trap at 80 bpm) so first-run users hear real music instead of silence.
- **Per-slot instrument kind** — each of the 4 rows in a cell can be set to any of `drums`, `bass`, `guitar`, `vocals`, `fx`. Duplicates allowed (two drum rows per cell, for example).
- **fx instrument kind** — new 5th kind for synth, ambient, glitch, pad, and effect samples.
- **Cell preview in the matrix grid** — each cell renders a 4×8 dot grid showing its own step programming, so you can see which cell has what before clicking in.
- **Sample glyphs on the grid** — active steps display a 1-3 char abbreviation of the sample name (e.g. `K8` for "Kick 808") so you can read the pattern at a glance.
- **Recording** — capture full matrix loops to WAV (takes under 2 min) or compressed webm (longer takes). Custom synthwave-styled audio player for take playback with transport-exclusive playback. Dynamic cap computed from bpm × enabled cell count.
- **Real-time collaboration** — project presence via Firestore subcollection, broadcasts each peer's currently-focused cell + track + step.
- **Expanded sample library** — 1,344 built-in samples sourced from [TidalCycles dirt-samples](https://github.com/tidalcycles/dirt-samples) (CC-BY 3.0), organized by kind/category:
  - drums: kick, snare, hihat, openhat, clap, cowbell, tom, crash, perc, break, 808, 909, machine, acoustic
  - bass, guitar, vocals
  - fx: synth, ambient, glitch, stabs, pads
- **Offline-first save queue** — projects keep editing through network outages; saves replay on reconnect via IndexedDB queue.
- **PWA manifest** — installable on mobile with standalone display mode.
- **Username validation** — shared profanity filter (leetspeak-aware) between client-side UX and server-side Zod refinement.

---

## Architecture

Monorepo with three workspaces:

```
client/    # Vite + React SPA (deployed to Firebase Hosting)
server/    # Express BFF exported as a Firebase Function (Cloud Run gen 2)
shared/    # Shared TypeScript types, migrations, validators
```

Data flow:
- **Reads** of own/public data go directly from the client's Firestore SDK (no round-trip through the BFF for dashboards/snapshot subscriptions).
- **Writes** go through the Express BFF for input validation, rate limiting, and cross-document consistency (owner-only edits, collaborator-only writes, schema-downgrade protection).
- **Sample playback** — `samplesSlice` caches sample metadata, `SamplePool` caches decoded `AudioBuffer`s per `{sampleId}:{version}` key, voices attach buffers on pattern change, matrix controller re-forwards samples on each cell boundary.
- **Matrix transport** — single `Tone.Sequence` owns step playback. Cell advancement is triggered by the sequence's step-7 callback (between current bar's last step and the next bar's step 0) so the snapshot swap happens before step 0 reads it.
- **Undo/redo** — Immer patch-based, scoped to the selected cell. Cell-switch clears history to prevent patches replaying on the wrong cell.
- **Schema versioning** — `ProjectMatrix.schemaVersion === 2` replaces the legacy flat `Pattern.schemaVersion === 1`. Server Zod validator accepts both on read via a discriminated union on `schemaVersion`; PATCH refuses v1-over-v2 writes to prevent schema downgrade.

See [PLAN.md](./PLAN.md) for the full architectural decisions + phase roadmap that preceded this repo.

---

## Dev

### Prerequisites

- Node.js 20+
- Firebase CLI (`npm i -g firebase-tools`) — only needed for deployment
- Google Cloud SDK (`gcloud auth application-default login`) — required for server dev auth

### Install + run

```bash
npm install
npm run dev          # client on :5173, server on :3001
```

### Environment setup

Client (`client/.env.local`):
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=beats-prod-ant.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=beats-prod-ant
VITE_FIREBASE_STORAGE_BUCKET=beats-prod-ant.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_USE_EMULATORS=false
VITE_API_BASE=/api
```

Server (`server/.env`):
```
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:5173,http://localhost:5000
GOOGLE_APPLICATION_CREDENTIALS=/path/to/application_default_credentials.json
```

### Deploy

```bash
npm run deploy:hosting    # client only (fast — ~10s)
npm run deploy:all        # client + server (Cloud Build takes ~2 min for server)
```

---

## Sample library

Built-in samples are sourced from [TidalCycles dirt-samples](https://github.com/tidalcycles/dirt-samples), licensed under **CC-BY 3.0**. To refresh or expand:

```bash
npm run import:dirt-samples          # clone upstream + remap folders
npm run clear:builtin-samples -- --confirm   # wipe old library
npm run seed:samples                  # upload to Firebase + write Firestore docs
```

The mapping from upstream folder names → your `kind/category` layout lives in `scripts/import-dirt-samples.ts`. Unmapped upstream folders are listed after each import run so you can extend the mapping and re-run.

---

## Tests

```bash
npm run typecheck         # shared + client + server
npm run test -w client    # vitest
npm run lint              # eslint
```

Currently 46 tests across 8 suites covering the matrix slice, transport exclusivity, command history, snapshot freezing, sample pool, subscribers, WAV encoder, and matrix controller cell-advancement logic.

---

## Credits

- Original sequencer concept + behavior spec: [FC-TEAM-VISA/beatdriver](https://github.com/FC-TEAM-VISA/beatdriver)
- Built-in sample library: [TidalCycles dirt-samples](https://github.com/tidalcycles/dirt-samples) — CC-BY 3.0
- Audio engine: [Tone.js](https://tonejs.github.io)
