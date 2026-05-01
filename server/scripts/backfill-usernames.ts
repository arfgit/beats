/**
 * One-shot User v1 → v2 migration.
 *
 * Sets schemaVersion: 2, username: "", usernameLower: "" on every doc
 * that lacks them, and seeds authProviders: ["google.com"] for legacy
 * users (every existing user signed in via Google before this migration
 * landed).
 *
 * Deliberately does NOT write `emailVerified` for legacy docs:
 *  - codex review #7 flagged that writing `false` creates a temporary
 *    false-negative population that can break verification gates before
 *    the user signs in again.
 *  - the /auth/session handler now refreshes emailVerified from the
 *    Firebase token whenever a user actually authenticates.
 *
 * Run with:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npx tsx server/scripts/backfill-usernames.ts
 *
 * Or with --dry-run to preview the writes without committing.
 *
 * Idempotent: re-running on already-migrated docs is a no-op (the
 * presence check skips them).
 */

import { db } from "../src/services/firebase-admin.js";
import { logger } from "../src/lib/logger.js";

interface BackfillResult {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  errors: number;
}

async function backfill(dryRun: boolean): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    migrated: 0,
    alreadyMigrated: 0,
    errors: 0,
  };

  const snap = await db.collection("users").get();
  // Batched writes to amortize the per-write RTT — Firestore allows up
  // to 500 ops per batch. We cap at 400 to leave headroom for the
  // implicit doc-update overhead.
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    result.scanned++;
    const data = doc.data() as Record<string, unknown>;
    const needsUsernameField = !("username" in data);
    const needsLowerField = !("usernameLower" in data);
    const needsProviders =
      !Array.isArray(data.authProviders) ||
      (data.authProviders as unknown[]).length === 0;
    const needsSchemaVersion = data.schemaVersion !== 2;

    if (
      !needsUsernameField &&
      !needsLowerField &&
      !needsProviders &&
      !needsSchemaVersion
    ) {
      result.alreadyMigrated++;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (needsUsernameField) updates.username = "";
    if (needsLowerField) updates.usernameLower = "";
    // Every existing user signed in via Google — there was no other
    // provider before this migration. New email/password / phone users
    // get their providers written by /auth/session at sign-up time.
    if (needsProviders) updates.authProviders = ["google.com"];
    if (needsSchemaVersion) updates.schemaVersion = 2;

    if (dryRun) {
      logger.info({ uid: doc.id, updates }, "[dry-run] would migrate");
      result.migrated++;
      continue;
    }

    batch.update(doc.ref, updates);
    pending++;
    result.migrated++;

    if (pending >= BATCH_SIZE) {
      try {
        await batch.commit();
      } catch (err) {
        logger.error({ err }, "batch commit failed");
        result.errors += pending;
        result.migrated -= pending;
      }
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0 && !dryRun) {
    try {
      await batch.commit();
    } catch (err) {
      logger.error({ err }, "final batch commit failed");
      result.errors += pending;
      result.migrated -= pending;
    }
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  logger.info({ dryRun }, "starting username backfill");
  const result = await backfill(dryRun);
  logger.info(result, "backfill complete");
  if (result.errors > 0) process.exit(1);
}

void main().catch((err) => {
  logger.error({ err }, "backfill crashed");
  process.exit(1);
});
