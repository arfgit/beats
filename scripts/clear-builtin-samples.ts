/**
 * Wipe the built-in sample library from Firebase — both the Firestore
 * `samples/{id}` docs where `isBuiltIn === true` AND the Storage
 * objects under `samples/builtin/**`. Used when swapping out the whole
 * library (e.g. switching to dirt-samples) so the seeder starts from a
 * clean slate instead of stacking new content on top of old.
 *
 * SAFETY: requires confirmation via --confirm flag. Does not touch
 * user-uploaded samples (those have `isBuiltIn === false` and live
 * under a different storage prefix).
 *
 * Run with: npm run clear:builtin-samples -- --confirm
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "beats-prod-ant";
const BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.firebasestorage.app`;

if (!process.argv.includes("--confirm")) {
  console.error(
    `refusing to delete without --confirm.\n\n` +
      `this will delete EVERY built-in sample doc in Firestore\n` +
      `and every object under gs://${BUCKET}/samples/builtin/.\n\n` +
      `user-uploaded samples are unaffected.\n\n` +
      `to proceed:\n` +
      `  npm run clear:builtin-samples -- --confirm`,
  );
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });

const db = getFirestore();
const bucket = getStorage().bucket();

async function deleteFirestoreDocs(): Promise<number> {
  const snap = await db
    .collection("samples")
    .where("isBuiltIn", "==", true)
    .get();
  if (snap.empty) return 0;
  // Batch-delete in chunks of 500 (Firestore batch limit).
  let total = 0;
  const chunks: (typeof snap.docs)[] = [];
  for (let i = 0; i < snap.docs.length; i += 500) {
    chunks.push(snap.docs.slice(i, i + 500));
  }
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const doc of chunk) batch.delete(doc.ref);
    await batch.commit();
    total += chunk.length;
    console.log(`  deleted ${total}/${snap.size} firestore docs`);
  }
  return total;
}

async function deleteStorageObjects(): Promise<number> {
  const [files] = await bucket.getFiles({ prefix: "samples/builtin/" });
  if (files.length === 0) return 0;
  let done = 0;
  // Delete in parallel with a bounded concurrency — unbounded Promise.all
  // on thousands of files triggers rate limits on some regions.
  const concurrency = 20;
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map((f) =>
        f.delete().catch((err) => {
          console.warn(`  failed to delete ${f.name}: ${String(err)}`);
        }),
      ),
    );
    done += batch.length;
    if (done % 100 === 0 || done === files.length) {
      console.log(`  deleted ${done}/${files.length} storage objects`);
    }
  }
  return done;
}

async function run(): Promise<void> {
  console.log(`clearing built-in samples from project ${PROJECT_ID}…`);
  console.log(`\nfirestore:`);
  const docsDeleted = await deleteFirestoreDocs();
  console.log(`  ${docsDeleted} total`);
  console.log(`\nstorage (gs://${BUCKET}/samples/builtin/):`);
  const objectsDeleted = await deleteStorageObjects();
  console.log(`  ${objectsDeleted} total`);
  console.log(`\ndone — re-run \`npm run seed:samples\` to repopulate.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
