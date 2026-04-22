/**
 * Pull the TidalCycles dirt-samples library (CC-BY 3.0) and remap its
 * flat folder structure into the drums/<category>/, bass/, guitar/,
 * vocals/, fx/ layout that seed-samples.ts expects.
 *
 * Runs in three steps:
 *   1. clone (or pull) the upstream repo into scripts/.dirt-samples-cache/
 *   2. walk the FOLDER_MAPPING and copy files into .processed-samples/
 *   3. emit a summary of what was imported vs. skipped
 *
 * After running this, execute `npm run seed:samples` to upload to
 * Firebase Storage + write the Firestore sample docs.
 *
 * Attribution (required by CC-BY): credit the TidalCycles community in
 * your credits/README — see https://github.com/tidalcycles/dirt-samples
 *
 * Run with: npm run import:dirt-samples
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
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, ".dirt-samples-cache");
const OUTPUT_DIR = path.join(__dirname, ".processed-samples");
const REPO_URL = "https://github.com/tidalcycles/dirt-samples.git";

/**
 * Source folder → destination path inside .processed-samples/.
 *
 * Kept conservative: included folders are the ones whose contents sound
 * musical enough to use in a beat-making app. Lots of dirt-samples
 * folders are speech / alphabet / voice clips that don't fit our
 * "pick a sample, set a step" model; those stay out.
 *
 * Format: source folder name (as it appears in the dirt-samples repo)
 * → [kind, category?] tuple. Category is optional and only used for
 * drum subcategories.
 */
const FOLDER_MAPPING: Record<string, [string, string?]> = {
  // --- drums/kick ---
  bd: ["drums", "kick"],
  "808bd": ["drums", "kick"],
  clubkick: ["drums", "kick"],
  hardkick: ["drums", "kick"],
  popkick: ["drums", "kick"],
  reverbkick: ["drums", "kick"],
  kicklinn: ["drums", "kick"],

  // --- drums/snare ---
  sd: ["drums", "snare"],
  "808sd": ["drums", "snare"],
  sn: ["drums", "snare"],

  // --- drums/hihat (closed) ---
  hh: ["drums", "hihat"],
  "808hc": ["drums", "hihat"],
  hc: ["drums", "hihat"],
  hh27: ["drums", "hihat"],
  linnhats: ["drums", "hihat"],

  // --- drums/openhat ---
  ho: ["drums", "openhat"],
  oh: ["drums", "openhat"],
  "808oh": ["drums", "openhat"],

  // --- drums/clap ---
  cp: ["drums", "clap"],
  cr: ["drums", "clap"],
  realclaps: ["drums", "clap"],

  // --- drums/cowbell ---
  cb: ["drums", "cowbell"],

  // --- drums/tom ---
  ht: ["drums", "tom"],
  lt: ["drums", "tom"],
  mt: ["drums", "tom"],
  "808ht": ["drums", "tom"],
  "808lt": ["drums", "tom"],
  "808mt": ["drums", "tom"],
  "808lc": ["drums", "tom"],
  "808mc": ["drums", "tom"],

  // --- drums/crash ---
  cy: ["drums", "crash"],
  "808cy": ["drums", "crash"],

  // --- drums/perc ---
  perc: ["drums", "perc"],
  hand: ["drums", "perc"],
  rs: ["drums", "perc"],
  tabla: ["drums", "perc"],
  tabla2: ["drums", "perc"],
  tablex: ["drums", "perc"],

  // --- drums/break ---
  amencutup: ["drums", "break"],

  // --- drums/909 & 808 & machines ---
  "909": ["drums", "909"],
  "808": ["drums", "808"],
  drumtraks: ["drums", "machine"],
  dr: ["drums", "machine"],
  dr2: ["drums", "machine"],
  dr55: ["drums", "machine"],
  em2: ["drums", "machine"],
  odx: ["drums", "machine"],
  sequential: ["drums", "machine"],
  rm: ["drums", "machine"],

  // --- drums/acoustic ---
  jazz: ["drums", "acoustic"],
  gretsch: ["drums", "acoustic"],

  // --- bass (flat) ---
  bass: ["bass"],
  bass0: ["bass"],
  bass1: ["bass"],
  bass2: ["bass"],
  bass3: ["bass"],
  bassdm: ["bass"],
  bassfoo: ["bass"],
  jungbass: ["bass"],
  jvbass: ["bass"],
  sid: ["bass"],
  moog: ["bass"],
  juno: ["bass"],

  // --- guitar (flat) ---
  gtr: ["guitar"],
  e: ["guitar"],
  sitar: ["guitar"],

  // --- vocals (flat) ---
  alex: ["vocals"],
  alphabet: ["vocals"],
  baa: ["vocals"],
  baa2: ["vocals"],
  breath: ["vocals"],
  haw: ["vocals"],
  hmm: ["vocals"],
  koy: ["vocals"],
  mouth: ["vocals"],
  print: ["vocals"],
  speech: ["vocals"],
  trump: ["vocals"],
  yeah: ["vocals"],
  voodoo: ["vocals"],
  miniyeah: ["vocals"],

  // --- fx (new kind — synths, ambient, glitch) ---
  arp: ["fx"],
  arpy: ["fx"],
  bleep: ["fx"],
  blip: ["fx"],
  fm: ["fx"],
  future: ["fx"],
  hoover: ["fx"],
  noise: ["fx"],
  noise2: ["fx"],
  pad: ["fx"],
  padlong: ["fx"],
  rave: ["fx"],
  rave2: ["fx"],
  ravemono: ["fx"],
  simplesine: ["fx"],
  stab: ["fx"],
  wobble: ["fx"],
  click: ["fx"],
  dist: ["fx"],
  flick: ["fx"],
  glitch: ["fx"],
  glitch2: ["fx"],
  short: ["fx"],
  birds: ["fx"],
  birds3: ["fx"],
  wind: ["fx"],
  bottle: ["fx"],
  bubble: ["fx"],
  can: ["fx"],
  glasstap: ["fx"],
  metal: ["fx"],
  pebbles: ["fx"],
  coins: ["fx"],
  circus: ["fx"],
  insect: ["fx"],
  casio: ["fx"],
  psr: ["fx"],
  sax: ["fx"],
  space: ["fx"],
  cosmicg: ["fx"],
  subroc3d: ["fx"],
  bend: ["fx"],
  notes: ["fx"],
  newnotes: ["fx"],
  pluck: ["fx"],
  tink: ["fx"],
  house: ["fx"],
  tech: ["fx"],
  techno: ["fx"],
};

function ensureRepo(): void {
  if (existsSync(CACHE_DIR)) {
    console.log(`pulling latest dirt-samples into ${CACHE_DIR}`);
    const res = spawnSync("git", ["-C", CACHE_DIR, "pull", "--ff-only"], {
      stdio: "inherit",
    });
    if (res.status !== 0) {
      console.error(
        "git pull failed — try deleting the cache dir and re-running",
      );
      process.exit(1);
    }
    return;
  }
  console.log(`cloning ${REPO_URL} → ${CACHE_DIR}`);
  const res = spawnSync("git", ["clone", "--depth", "1", REPO_URL, CACHE_DIR], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    console.error("git clone failed");
    process.exit(1);
  }
}

function listAudioFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(wav|aif|aiff|ogg|flac)$/i.test(f))
    .filter((f) => {
      try {
        return statSync(path.join(dir, f)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function cleanName(raw: string): string {
  // Strip leading/trailing separators, lowercase, collapse runs of - or _.
  return raw
    .toLowerCase()
    .replace(/\.(wav|aif|aiff|ogg|flac)$/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function run(): void {
  ensureRepo();

  if (existsSync(OUTPUT_DIR)) {
    console.log(`clearing existing ${OUTPUT_DIR}`);
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let copied = 0;
  let skipped = 0;
  const byKind: Record<string, number> = {};
  const missingFolders: string[] = [];

  for (const [sourceFolder, [kind, category]] of Object.entries(
    FOLDER_MAPPING,
  )) {
    const sourceDir = path.join(CACHE_DIR, sourceFolder);
    if (!existsSync(sourceDir)) {
      missingFolders.push(sourceFolder);
      continue;
    }
    const destDir = category
      ? path.join(OUTPUT_DIR, kind, category)
      : path.join(OUTPUT_DIR, kind);
    mkdirSync(destDir, { recursive: true });

    const files = listAudioFiles(sourceDir);
    if (files.length === 0) continue;
    // Prefix dest filenames with the source folder name so multi-folder
    // mappings (e.g. bd + 808bd → drums/kick) don't collide on "1.wav".
    for (const file of files) {
      const destName = `${sourceFolder}-${cleanName(file)}.wav`;
      const destPath = path.join(destDir, destName);
      copyFileSync(path.join(sourceDir, file), destPath);
      copied++;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
  }

  // Report folders present in the repo but not in our mapping, so we
  // can tune the mapping as upstream changes.
  const repoFolders = readdirSync(CACHE_DIR).filter((name) => {
    if (name.startsWith(".")) return false;
    try {
      return statSync(path.join(CACHE_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const unmapped = repoFolders.filter(
    (f) => !(f in FOLDER_MAPPING) && f !== "node_modules",
  );

  console.log(`\n— summary —`);
  console.log(`files copied: ${copied}`);
  console.log(`skipped: ${skipped}`);
  console.log(`by kind:`);
  for (const [kind, count] of Object.entries(byKind).sort()) {
    console.log(`  ${kind}: ${count}`);
  }
  if (missingFolders.length) {
    console.log(
      `\nmissing upstream folders (listed in mapping but not in repo):`,
    );
    for (const f of missingFolders) console.log(`  ${f}`);
  }
  if (unmapped.length) {
    console.log(
      `\nunmapped upstream folders (${unmapped.length}) — add to FOLDER_MAPPING to include:`,
    );
    console.log(`  ${unmapped.join(", ")}`);
  }
  console.log(
    `\ndone — ready to upload. run: npm run seed:samples (then the UI will pick them up).`,
  );
}

run();
