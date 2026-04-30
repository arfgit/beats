import type {
  EffectKind,
  ProjectMatrix,
  SampleRef,
  Track,
  TrackKind,
} from "@beats/shared";
import { EFFECT_KINDS, STEP_COUNT } from "@beats/shared";
import { snapshotForStep, snapshotForTrack } from "./sampleSnapshot";

export type SamplesByKind = Record<TrackKind, SampleRef[]>;

interface DemoComposer {
  (byKind: SamplesByKind): ProjectMatrix;
  beatName: string;
}

/** Find a sample whose category matches; falls back to the first entry. */
function pickByCategory(samples: SampleRef[], category: string): SampleRef {
  return samples.find((s) => s.category === category) ?? samples[0]!;
}

/** Build a single track with a chosen sample + an 8-step pattern. */
function buildTrack(
  id: string,
  kind: TrackKind,
  sample: SampleRef | null,
  stepsActive: readonly number[],
  gain = 0.8,
  velocities?: Partial<Record<number, number>>,
): Track {
  const trackSnapshot = snapshotForTrack(sample);
  const stepSnapshot = snapshotForStep(sample);
  return {
    id,
    kind,
    ...trackSnapshot,
    gain,
    muted: false,
    soloed: false,
    steps: Array.from({ length: STEP_COUNT }, (_, i) => {
      const active = stepsActive.includes(i);
      return {
        active,
        velocity: velocities?.[i] ?? 1,
        // Pin the sample identity (id, version, name) onto each active
        // step so swapping the track's sample later doesn't retroactively
        // re-label already-placed steps and so labels paint before the
        // samples library hydrates.
        ...(active && sample ? stepSnapshot : {}),
      };
    }),
  };
}

/**
 * Default effect chain for a demo cell. Effects named in `enabledKinds`
 * ship engaged so a freshly-seeded demo sounds like the composer
 * intended — previously they were always disabled while the knobs still
 * showed tweaked values, which confused users who turned the cell on
 * and heard no effect.
 */
function demoEffects(enabledKinds: readonly EffectKind[] = []) {
  const paramsByKind: Record<EffectKind, Record<string, number>> = {
    chorus: { wet: 0.4, frequency: 1.5, depth: 0.5 },
    phaser: { wet: 0.35, frequency: 0.5, octaves: 3 },
    tremolo: { wet: 0.35, frequency: 5, depth: 0.5 },
    moogFilter: { wet: 0.5, cutoff: 1800, resonance: 1.2 },
  };
  return EFFECT_KINDS.map((kind) => ({
    kind,
    enabled: enabledKinds.includes(kind),
    params: paramsByKind[kind],
  }));
}

/** Safe pick: returns `null` when the library has nothing of this kind. */
function pickOrNull(samples: SampleRef[], i = 0): SampleRef | null {
  if (samples.length === 0) return null;
  return samples[Math.min(i, samples.length - 1)]!;
}

/**
 * Assemble a full ProjectMatrix from per-cell track definitions. Shared
 * helper so each demo composer can focus on the musical decisions
 * instead of matrix plumbing.
 */
function assembleMatrix(
  cellDefs: Array<{
    id: string;
    tracks: Track[];
    enabled: boolean;
    enabledEffects?: readonly EffectKind[];
  }>,
  sharedBpm: number,
  defaultEffects: readonly EffectKind[] = [],
): ProjectMatrix {
  return {
    schemaVersion: 2,
    sharedBpm,
    masterGain: 0.8,
    cells: cellDefs.map((def) => ({
      id: def.id,
      enabled: def.enabled,
      pattern: { stepCount: STEP_COUNT, tracks: def.tracks },
      effects: demoEffects(def.enabledEffects ?? defaultEffects),
    })),
  };
}

// ----- Composer #1: Neon Pulse (original progressive 9-cell arc) ------

const neonPulseDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const clap = pickByCategory(byKind.drums, "clap");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 1)!;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const guitarB = pickOrNull(byKind.guitar, 1);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 1);

    // Step positions use 0-indexed slots (0..7). Each bar is 8th-notes.
    const cellDefs = [
      // Cell 0 — Intro groove: solo kick + hihat
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "drums", hihat, [1, 3, 5, 7], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bass pulse
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "drums", hihat, [1, 3, 5, 7], 0.45),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Add clap backbeat (build)
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "drums", clap, [2, 6], 0.8),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.45),
        ],
      },
      // Cell 3 — Drop: four-on-the-floor + driving bass + snare backbeat
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 2, 4, 6], 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.7,
          ),
          buildTrack("track-guitar", "drums", snare, [2, 6], 0.85),
          buildTrack(
            "track-vocals",
            "drums",
            hihat,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.4,
          ),
        ],
      },
      // Cell 4 — Breakdown: sparse atmosphere
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0]),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.7),
        ],
      },
      // Cell 5 — Guitar hook introduced
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.7, {
            0: 1,
            2: 0.7,
            4: 1,
            6: 0.7,
          }),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.45),
        ],
      },
      // Cell 6 — Full groove: drums + bass + guitar + hats
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassA, [0, 2, 4, 6], 0.7),
          buildTrack("track-guitar", "guitar", guitarA, [0, 3, 4, 7], 0.7),
          buildTrack("track-vocals", "drums", snare, [2, 6], 0.85),
        ],
      },
      // Cell 7 — Vocal moment
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4]),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.6),
          buildTrack("track-guitar", "guitar", guitarB, [0, 4], 0.6),
          buildTrack("track-vocals", "vocals", vocalB, [2, 6], 0.9),
        ],
      },
      // Cell 8 — Finale / crescendo
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 2, 4, 6], 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.75,
          ),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.75),
          buildTrack("track-vocals", "drums", clap, [3, 7], 0.9),
        ],
      },
    ];

    // Signature: chorus on every cell for synthwave shimmer. Breakdown
    // (cell 4) and vocal moment (cell 7) add phaser for motion.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 7
          ? (["chorus", "phaser"] as const)
          : (["chorus"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 108);
  },
  { beatName: "neon pulse" },
);

// ----- Composer #2: Four-on-the-Floor — house-inspired 124 bpm ---------

const fourOnFloorDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const openhat = pickByCategory(byKind.drums, "openhat");
    const clap = pickByCategory(byKind.drums, "clap");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 2) ?? bassA;
    const stab = pickOrNull(byKind.fx, 0);
    const stabB = pickOrNull(byKind.fx, 3) ?? stab;
    const vocalA = pickOrNull(byKind.vocals, 0);

    // All cells share the four-on-the-floor foundation (kick on every
    // downbeat); variation comes from top layer + bass figure + stabs.
    const four = [0, 2, 4, 6];
    const clapBeat = [2, 6];
    const off = [1, 3, 5, 7];

    const cellDefs = [
      // Cell 0 — Straight 4x4 kick + hats
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "drums", hihat, off, 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bassline + offbeat open hats
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack("track-guitar", "drums", openhat, off, 0.55),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Clap on 2 & 4, syncopated hat
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack("track-guitar", "drums", clap, clapBeat, 0.85),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.5),
        ],
      },
      // Cell 3 — Pump: snare fill + busy bass
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.7,
          ),
          buildTrack("track-guitar", "drums", snare, clapBeat, 0.85),
          buildTrack("track-vocals", "drums", openhat, off, 0.55),
        ],
      },
      // Cell 4 — Stab riff
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, [0, 3, 4, 7], 0.7),
          buildTrack("track-guitar", "fx", stab, [0, 3, 4, 7], 0.8),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.8),
        ],
      },
      // Cell 5 — Break: no kick, vocal hit
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", clap, clapBeat, 0.85),
          buildTrack("track-bass", "bass", bassB, [0, 4], 0.55),
          buildTrack("track-guitar", "fx", stab, [2, 6], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.9),
        ],
      },
      // Cell 6 — Pump back in
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack("track-bass", "bass", bassA, four, 0.75),
          buildTrack("track-guitar", "fx", stabB, [1, 5], 0.75),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.9),
        ],
      },
      // Cell 7 — Layered top: hat + stab
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.9),
          buildTrack("track-bass", "bass", bassA, four, 0.7),
          buildTrack(
            "track-guitar",
            "drums",
            hihat,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.5,
          ),
          buildTrack("track-vocals", "fx", stab, [0, 2, 4, 6], 0.7),
        ],
      },
      // Cell 8 — Full flight
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, four, 0.95),
          buildTrack(
            "track-bass",
            "bass",
            bassA,
            [0, 1, 2, 3, 4, 5, 6, 7],
            0.8,
          ),
          buildTrack("track-guitar", "fx", stabB, [0, 2, 4, 6], 0.8),
          buildTrack("track-vocals", "drums", clap, clapBeat, 0.95),
        ],
      },
    ];

    // Signature: moogFilter for that classic house filter pump. Sweep
    // cells (2, 3, 5) narrow the cutoff for build tension.
    const cellsWithSignature = cellDefs.map((def, i) => {
      const isSweep = i === 2 || i === 3 || i === 5;
      return {
        ...def,
        enabledEffects: isSweep ? (["moogFilter"] as const) : ([] as const),
      };
    });
    return assembleMatrix(cellsWithSignature, 124);
  },
  { beatName: "four on the floor" },
);

// ----- Composer #3: Lo-Fi Trap — slow 80 bpm vibe ---------------------

const lofiTrapDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const perc = pickByCategory(byKind.drums, "perc");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 2) ?? vocalA;
    const fxA = pickOrNull(byKind.fx, 0);
    const fxB = pickOrNull(byKind.fx, 2) ?? fxA;

    // Trap uses dotted / syncopated kick placement + rolled hats. We
    // simulate rolls inside 8 steps with consecutive hits at reduced
    // velocity.
    const trapKick = [0, 3, 6];
    const doubleTimeHat = [0, 1, 2, 3, 4, 5, 6, 7];
    const snareBackbeat = [2, 6];

    const cellDefs = [
      // Cell 0 — Vinyl-tape intro: sparse perc
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", perc, [2, 6], 0.6),
          buildTrack("track-bass", "fx", fxA, [0, 4], 0.5),
          buildTrack("track-guitar", "guitar", null, []),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Enter kick
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "drums", perc, [2, 6], 0.55),
          buildTrack("track-guitar", "fx", fxA, [0, 4], 0.5),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 2 — Bass enters, sparse snare
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.75),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.4),
        ],
      },
      // Cell 3 — Hi-hat rolls (double-time hat)
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.8),
          buildTrack("track-vocals", "drums", hihat, doubleTimeHat, 0.45, {
            0: 0.8,
            1: 0.4,
            2: 0.8,
            3: 0.4,
            4: 0.8,
            5: 0.4,
            6: 0.8,
            7: 0.4,
          }),
        ],
      },
      // Cell 4 — Melody moment: guitar
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 6], 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.6),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.7),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.4),
        ],
      },
      // Cell 5 — Vocal chop
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.85),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.65),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.8),
          buildTrack("track-vocals", "vocals", vocalA, [1, 5], 0.9),
        ],
      },
      // Cell 6 — Breakdown: all stops but perc + pad
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", perc, [1, 4, 6], 0.6),
          buildTrack("track-bass", "fx", fxB, [0, 4], 0.55),
          buildTrack("track-guitar", "guitar", guitarA, [0], 0.7),
          buildTrack("track-vocals", "vocals", vocalB, [4], 0.85),
        ],
      },
      // Cell 7 — Return with full rhythm + vocal
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, trapKick, 0.9),
          buildTrack("track-bass", "bass", bassA, [0, 4], 0.7),
          buildTrack("track-guitar", "drums", snare, snareBackbeat, 0.85),
          buildTrack("track-vocals", "vocals", vocalA, [2, 6], 0.9),
        ],
      },
      // Cell 8 — Outro fade
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0], 0.7),
          buildTrack("track-bass", "bass", bassA, [0], 0.5),
          buildTrack("track-guitar", "guitar", guitarA, [0], 0.6),
          buildTrack("track-vocals", "drums", perc, [2, 4, 6], 0.5),
        ],
      },
    ];

    // Signature: tremolo for that washed, cassette-warbling quality.
    // Melody cells (4, 5) stack chorus for thicker vocal chops.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 5
          ? (["tremolo", "chorus"] as const)
          : (["tremolo"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 80);
  },
  { beatName: "lo-fi trap" },
);

// ----- Composer #4: Boom-Bap — 90bpm head-nodder with swing ------------

const boomBapDemo: DemoComposer = Object.assign(
  (byKind: SamplesByKind): ProjectMatrix => {
    const kick = pickByCategory(byKind.drums, "kick");
    const snare = pickByCategory(byKind.drums, "snare");
    const hihat = pickByCategory(byKind.drums, "hihat");
    const openhat = pickByCategory(byKind.drums, "openhat");
    const perc = pickByCategory(byKind.drums, "perc");
    const bassA = pickOrNull(byKind.bass, 0)!;
    const bassB = pickOrNull(byKind.bass, 3) ?? bassA;
    const guitarA = pickOrNull(byKind.guitar, 0);
    const vocalA = pickOrNull(byKind.vocals, 0);
    const vocalB = pickOrNull(byKind.vocals, 3) ?? vocalA;

    // Classic boom-bap: kick-and-snare on the 1/3 (really 0, 2, 5 in 8-step),
    // hats on the quarters, bass reinforcing the kick with a walking shape.
    const kickPattern = [0, 5];
    const snarePattern = [2, 6];
    const hatQuarters = [0, 2, 4, 6];

    const cellDefs = [
      // Cell 0 — Head: sparse drums only
      {
        id: "c0",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "drums", hihat, hatQuarters, 0.55),
          buildTrack("track-vocals", "vocals", null, []),
        ],
      },
      // Cell 1 — Add bass walk
      {
        id: "c1",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", hihat, hatQuarters, 0.55),
        ],
      },
      // Cell 2 — Off-beat hats for swing
      {
        id: "c2",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", hihat, [1, 3, 5, 7], 0.5),
        ],
      },
      // Cell 3 — Vocal chop lands
      {
        id: "c3",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [0, 4], 0.85),
        ],
      },
      // Cell 4 — Guitar loop over drums
      {
        id: "c4",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "guitar", guitarA, [0, 2, 4, 6], 0.75),
          buildTrack("track-vocals", "drums", hihat, hatQuarters, 0.55),
        ],
      },
      // Cell 5 — Stripped: just kick + perc + vocal fill
      {
        id: "c5",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0, 4], 0.85),
          buildTrack("track-bass", "drums", perc, [2, 6], 0.65),
          buildTrack("track-guitar", "bass", bassB, [0, 4], 0.55),
          buildTrack("track-vocals", "vocals", vocalB, [1, 3, 5, 7], 0.8),
        ],
      },
      // Cell 6 — Full rhythm with open-hat accents
      {
        id: "c6",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "bass", bassA, [0, 3, 5, 7], 0.7),
          buildTrack("track-vocals", "drums", openhat, [3, 7], 0.7),
        ],
      },
      // Cell 7 — Vocal + guitar layered moment
      {
        id: "c7",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, kickPattern, 0.9),
          buildTrack("track-bass", "drums", snare, snarePattern, 0.85),
          buildTrack("track-guitar", "guitar", guitarA, [0, 4], 0.7),
          buildTrack("track-vocals", "vocals", vocalA, [2, 6], 0.85),
        ],
      },
      // Cell 8 — Outro: final snare hit with vocal tag
      {
        id: "c8",
        enabled: true,
        tracks: [
          buildTrack("track-drums", "drums", kick, [0], 0.85),
          buildTrack("track-bass", "drums", snare, [2, 4], 0.9),
          buildTrack("track-guitar", "bass", bassB, [0], 0.6),
          buildTrack("track-vocals", "vocals", vocalB, [6], 0.9),
        ],
      },
    ];

    // Signature: chorus on the melodic cells for warmth, subtle moogFilter
    // throughout for that lo-fi sample-rate quality typical of 90s hip-hop.
    const cellsWithSignature = cellDefs.map((def, i) => ({
      ...def,
      enabledEffects:
        i === 4 || i === 7
          ? (["chorus", "moogFilter"] as const)
          : (["moogFilter"] as const),
    }));
    return assembleMatrix(cellsWithSignature, 90);
  },
  { beatName: "boom-bap" },
);

// Rotating list of composers. Each call to composeNextDemoBeat advances
// the closed-over index so users cycle through all variants before
// landing back on the first.
const DEMO_COMPOSERS: DemoComposer[] = [
  neonPulseDemo,
  fourOnFloorDemo,
  lofiTrapDemo,
  boomBapDemo,
];
let demoIndex = 0;

/**
 * Run the next demo composer in rotation against the supplied sample
 * library. Returns the assembled matrix and the human-readable name
 * for toast display.
 */
export function composeNextDemoBeat(byKind: SamplesByKind): {
  matrix: ProjectMatrix;
  beatName: string;
} {
  const composer = DEMO_COMPOSERS[demoIndex % DEMO_COMPOSERS.length]!;
  demoIndex = (demoIndex + 1) % DEMO_COMPOSERS.length;
  return { matrix: composer(byKind), beatName: composer.beatName };
}
