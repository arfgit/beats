/**
 * Prepare the built-in sample library for a step-sequencer.
 *
 * Reads ~/Projects/music-collaboration-app-audio/built-in-instruments,
 * cleans filenames, trims long samples to MAX_DURATION_SEC with a short
 * fade-out, drops obvious loops, and writes the result to
 * scripts/.processed-samples/ so seed-samples.ts can upload clean audio.
 *
 * Run with: npm run process:samples
 */
import { spawnSync } from "node:child_process";
import {
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE = path.join(
  homedir(),
  "Projects/music-collaboration-app-audio/built-in-instruments",
);
const OUTPUT = path.join(__dirname, ".processed-samples");

const MAX_DURATION_SEC = 2.0;
const FADE_OUT_SEC = 0.08;
const HARD_FILTER_SEC = 10.0;

// Freesound user handles and library brands that don't describe the sound.
// Kept conservative — removing a token also erases any info it carried, so
// we only drop things that are clearly metadata noise.
const NOISE_TOKENS = new Set([
  "modularsamples",
  "mastartiq",
  "michaelmalong",
  "anoesj",
  "nfrae",
  "oxygen",
  "sp",
  "oriolgos",
]);

// Pattern filters for tokens we can't enumerate (kit codes, sample pack
// numbers, etc.). Applied after the fixed NOISE_TOKENS set.
const NOISE_PATTERNS: RegExp[] = [
  /^kit\d+$/i, // oxygen-style "kit01", "kit02"
];

interface Report {
  kind: string;
  category: string | null;
  sourceRel: string;
  outputRel: string | null;
  durationSec: number;
  action: "copy" | "trim" | "skip";
  reason?: string;
}

function walkAudio(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkAudio(full));
    else if (/\.(wav|mp3|aiff|aif)$/i.test(entry)) out.push(full);
  }
  return out;
}

function probeDurationSec(file: string): number {
  const res = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  );
  const parsed = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanBasename(
  raw: string,
  kind: string,
  category: string | null,
): string {
  // strip extension (handled at path level) + lowercase
  let name = raw.toLowerCase();

  // uniform separators
  name = name.replace(/[\s_]+/g, "-");

  // strip leading catalog IDs like "311252-" (freesound), keep short
  // numbers like "1-hit-…" or "808-…" which carry meaning
  name = name.replace(/^\d{5,}-+/, "");

  // split-and-filter by token so we can drop noise tokens wherever they land
  name = name
    .split("-")
    .filter((tok) => tok.length > 0)
    .filter((tok) => !NOISE_TOKENS.has(tok))
    .filter((tok) => !NOISE_PATTERNS.some((r) => r.test(tok)))
    // drop long catalog IDs (≥5 digits) but keep short numbers like
    // 808/909/606 which describe the sound (Roland drum machines, etc.)
    .filter((tok) => !/^\d{5,}$/.test(tok))
    // drop hex blobs that are clearly random IDs (mixed case or >=8 chars)
    .filter((tok) => !/^[a-f0-9]{8,}$/i.test(tok))
    // drop BPM tags "125bpm"
    .filter((tok) => !/^\d+bpm$/.test(tok))
    // drop library codes like "sp", "dd", "stb" that are 2-3 lowercase
    // consonants-only tokens and are near the end of the name
    .filter((tok) => !/^[bcdfghjklmnpqrstvwxz]{2,3}$/.test(tok))
    .join("-");

  // Category strip is always safe — the folder name provides context, so
  // drums/kick/kick-808.wav → "808.wav" reads cleanly as "kick 808".
  if (category) {
    const catPrefix = category.toLowerCase();
    name = name.replace(new RegExp(`^${catPrefix}-`), "");
  }

  // Kind strip is riskier — for flat categories (bass/guitar/vocals) we
  // lose the only contextual word if the rest is short or purely numeric.
  // Skip the strip when it would yield <3 chars or a pure-digit leftover.
  const kindPrefix = kind.toLowerCase();
  const withoutKind = name.replace(new RegExp(`^${kindPrefix}-`), "");
  if (
    withoutKind !== name &&
    withoutKind.length >= 3 &&
    !/^\d+$/.test(withoutKind)
  ) {
    name = withoutKind;
  }

  // collapse + trim
  name = name.replace(/-+/g, "-").replace(/^-|-$/g, "");

  // If stripping the prefix emptied the name (e.g. `clap-808` → `808`
  // was dropped by the digit filter elsewhere), fall back to the
  // category or kind so we never ship an empty filename.
  if (!name) name = category ?? kind;

  return (
    name ||
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
  );
}

function looksLikeLoop(
  sourceBasename: string,
  durationSec: number,
): string | null {
  if (durationSec >= HARD_FILTER_SEC)
    return `${durationSec.toFixed(1)}s > ${HARD_FILTER_SEC}s cap`;
  const low = sourceBasename.toLowerCase();
  // names with explicit bpm tags + long durations are almost always loops
  if (/\d+bpm/.test(low) && durationSec > 3.0) return "bpm tag + long duration";
  if (/yoddle|yodel|halcyon/.test(low)) return "named loop";
  return null;
}

function trim(input: string, output: string, durationSec: number): void {
  const t = Math.min(durationSec, MAX_DURATION_SEC);
  const fadeStart = Math.max(0, t - FADE_OUT_SEC);
  spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-t",
      t.toFixed(3),
      "-af",
      `afade=t=out:st=${fadeStart.toFixed(3)}:d=${FADE_OUT_SEC}`,
      "-ac",
      "2",
      "-ar",
      "44100",
      "-acodec",
      "pcm_s16le",
      output,
    ],
    { stdio: "inherit" },
  );
}

function run(): void {
  if (!existsSync(SOURCE)) {
    console.error(`source library missing: ${SOURCE}`);
    process.exit(1);
  }
  if (existsSync(OUTPUT)) rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });

  const reports: Report[] = [];
  const files = walkAudio(SOURCE).sort();
  console.log(`processing ${files.length} audio files…`);

  for (const sourceFile of files) {
    const rel = path.relative(SOURCE, sourceFile);
    const parts = rel.split(path.sep);
    const kind = parts[0]!;
    const category = parts.length > 2 ? parts[1]! : null;
    const originalBasename = path.basename(
      sourceFile,
      path.extname(sourceFile),
    );
    const duration = probeDurationSec(sourceFile);

    const loopReason = looksLikeLoop(originalBasename, duration);
    if (loopReason) {
      reports.push({
        kind,
        category,
        sourceRel: rel,
        outputRel: null,
        durationSec: duration,
        action: "skip",
        reason: loopReason,
      });
      continue;
    }

    const cleanName = cleanBasename(originalBasename, kind, category);
    const outputDir = category
      ? path.join(OUTPUT, kind, category)
      : path.join(OUTPUT, kind);
    mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `${cleanName}.wav`);

    const needsConvert = !/\.wav$/i.test(sourceFile);
    const needsTrim = duration > MAX_DURATION_SEC;

    if (!needsConvert && !needsTrim) {
      copyFileSync(sourceFile, outputFile);
      reports.push({
        kind,
        category,
        sourceRel: rel,
        outputRel: path.relative(OUTPUT, outputFile),
        durationSec: duration,
        action: "copy",
      });
    } else {
      trim(sourceFile, outputFile, duration);
      reports.push({
        kind,
        category,
        sourceRel: rel,
        outputRel: path.relative(OUTPUT, outputFile),
        durationSec: duration,
        action: "trim",
      });
    }
  }

  const copied = reports.filter((r) => r.action === "copy").length;
  const trimmed = reports.filter((r) => r.action === "trim").length;
  const skipped = reports.filter((r) => r.action === "skip");

  console.log(`\n— summary —`);
  console.log(`copied as-is: ${copied}`);
  console.log(`trimmed/converted: ${trimmed}`);
  console.log(`skipped (loops): ${skipped.length}`);
  if (skipped.length > 0) {
    console.log("\nskipped files:");
    for (const r of skipped) {
      console.log(
        `  ${r.sourceRel}  (${r.durationSec.toFixed(1)}s) — ${r.reason}`,
      );
    }
  }

  console.log(`\noutput: ${OUTPUT}`);
}

run();
