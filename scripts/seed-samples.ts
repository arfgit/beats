/**
 * Seeder for the built-in sample library. Reads from the processed staging
 * directory produced by `npm run process:samples`, uploads each file to
 * gs://<bucket>/samples/builtin/<kind>/<path>, and writes a Firestore doc
 * under `samples/{id}` so the studio's SampleRow can query by kind +
 * optional subcategory.
 *
 * Requires Application Default Credentials:
 *   gcloud auth application-default login
 *
 * Run with (in order):
 *   npm run process:samples
 *   npm run seed:samples
 *
 * Idempotent: re-runs skip storage uploads for files already present and
 * merge Firestore docs by id.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "beats-prod-ant";
const BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;
const SOURCE = path.join(__dirname, ".processed-samples");

// Derive the seeded kinds from the shared TRACK_KINDS tuple so adding
// a new instrument (e.g. "fx") in one place automatically brings it
// into the seed walk without another edit here.
import { TRACK_KINDS } from "../shared/src/index.js";
const KINDS = TRACK_KINDS;
type Kind = (typeof KINDS)[number];

interface SampleDoc {
  id: string;
  kind: Kind;
  category?: string;
  name: string;
  storagePath: string;
  version: number;
  durationMs: number;
  isBuiltIn: true;
  createdAt: number;
}

if (!existsSync(SOURCE)) {
  console.error(
    `processed sample directory missing: ${SOURCE}\n` +
      `run \`npm run process:samples\` first`,
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });

const db = getFirestore();
const bucket = getStorage().bucket();

function walkAudioFiles(dir: string): string[] {
  // Some kinds (e.g. "fx") may be absent if the import step didn't
  // supply any samples for them. Treat a missing directory as empty
  // rather than a hard error so one run can seed a partial library.
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkAudioFiles(full));
    else if (/\.(wav|mp3)$/i.test(entry)) out.push(full);
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function humanize(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();
}

function contentTypeFor(filename: string): string {
  if (filename.toLowerCase().endsWith(".mp3")) return "audio/mpeg";
  return "audio/wav";
}

interface Entry {
  absolutePath: string;
  relativeToKind: string; // e.g. "kick/kick-808.wav" for drums, "bass-01.wav" for bass
  kind: Kind;
  category: string | undefined;
  fileName: string;
  basename: string; // filename without extension
}

function buildEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const kind of KINDS) {
    const kindDir = path.join(SOURCE, kind);
    for (const file of walkAudioFiles(kindDir)) {
      const relativeToKind = path.relative(kindDir, file);
      const parts = relativeToKind.split(path.sep);
      const fileName = parts[parts.length - 1]!;
      const basename = path.basename(fileName, path.extname(fileName));
      const category = parts.length > 1 ? parts[0] : undefined;
      entries.push({
        absolutePath: file,
        relativeToKind,
        kind,
        category,
        fileName,
        basename,
      });
    }
  }
  return entries;
}

async function uploadIfMissing(entry: Entry): Promise<string> {
  const storagePath = `samples/builtin/${entry.kind}/${entry.relativeToKind.split(path.sep).join("/")}`;
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    await bucket.upload(entry.absolutePath, {
      destination: storagePath,
      metadata: {
        contentType: contentTypeFor(entry.fileName),
        cacheControl: "public, max-age=2592000", // 30 days
      },
    });
  }
  return storagePath;
}

function docIdFor(entry: Entry): string {
  const parts = [entry.kind];
  if (entry.category && entry.category !== entry.basename)
    parts.push(entry.category);
  parts.push(entry.basename);
  return slugify(parts.join("-"));
}

function displayNameFor(entry: Entry): string {
  if (entry.category && entry.category !== entry.basename) {
    return humanize(
      `${entry.category} ${entry.basename.replace(new RegExp(`^${entry.category}[-_]?`), "")}`,
    );
  }
  return humanize(entry.basename);
}

async function run(): Promise<void> {
  const entries = buildEntries();
  console.log(
    `discovered ${entries.length} audio files across ${KINDS.length} kinds`,
  );

  let uploaded = 0;
  let skipped = 0;
  let written = 0;

  for (const entry of entries) {
    const id = docIdFor(entry);
    const storagePath = await uploadIfMissing(entry);
    const uploadedThisRun = await bucket
      .file(storagePath)
      .getMetadata()
      .then(([m]) => Number(m.size ?? 0) > 0)
      .catch(() => false);
    if (uploadedThisRun) uploaded++;
    else skipped++;

    const doc: SampleDoc = {
      id,
      kind: entry.kind,
      ...(entry.category ? { category: entry.category } : {}),
      name: displayNameFor(entry),
      storagePath,
      version: 1,
      durationMs: 0,
      isBuiltIn: true,
      createdAt: Date.now(),
    };
    await db.collection("samples").doc(id).set(doc, { merge: true });
    written++;

    if (written % 20 === 0) console.log(`… ${written}/${entries.length}`);
  }

  console.log(
    `done — uploaded:${uploaded} skipped:${skipped} firestore_writes:${written}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
