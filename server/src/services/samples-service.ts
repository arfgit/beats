import {
  CUSTOM_SAMPLE_PER_USER_LIMIT,
  CUSTOM_SAMPLE_MAX_ENCODED_BYTES,
} from "@beats/shared";
import { db } from "./firebase-admin.js";

/**
 * Per-user quota gate for custom-sample uploads. Runs before a signed
 * PUT URL is issued so a user can't blow past the cap by spamming
 * upload-url requests in parallel — the read happens inside a
 * transaction with the increment so two concurrent uploads don't both
 * see "19 of 20" and slip past.
 */

export interface QuotaSnapshot {
  count: number;
  totalBytes: number;
}

/** Read-only — used for surfacing remaining quota to the client. */
export async function readQuota(uid: string): Promise<QuotaSnapshot> {
  const snap = await db.collection("userQuotas").doc(uid).get();
  if (!snap.exists) return { count: 0, totalBytes: 0 };
  const data = snap.data() as Partial<QuotaSnapshot>;
  return {
    count: Number(data.count ?? 0),
    totalBytes: Number(data.totalBytes ?? 0),
  };
}

/**
 * Atomic check + increment. Throws { code: "QUOTA_EXCEEDED" } if the
 * user is already at the limit. The increment happens up front so a
 * user can't bypass by abandoning uploads — orphan cleanup is the
 * compensating mechanism for those (see `releaseQuota` and the planned
 * orphan sweeper).
 */
export async function reserveQuotaSlot(uid: string): Promise<QuotaSnapshot> {
  const ref = db.collection("userQuotas").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current: QuotaSnapshot = snap.exists
      ? {
          count: Number(snap.data()?.count ?? 0),
          totalBytes: Number(snap.data()?.totalBytes ?? 0),
        }
      : { count: 0, totalBytes: 0 };
    if (current.count >= CUSTOM_SAMPLE_PER_USER_LIMIT) {
      const err = new Error("custom sample limit reached") as Error & {
        code: string;
      };
      err.code = "QUOTA_EXCEEDED";
      throw err;
    }
    const next = { count: current.count + 1, totalBytes: current.totalBytes };
    tx.set(ref, next, { merge: true });
    return next;
  });
}

/**
 * Roll back a slot reservation when a finalize fails or a sample is
 * deleted. Bytes accounting trues up after finalize when the actual
 * encoded size is known.
 */
export async function releaseQuotaSlot(
  uid: string,
  bytesToRelease = 0,
): Promise<void> {
  const ref = db.collection("userQuotas").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current: QuotaSnapshot = {
      count: Number(snap.data()?.count ?? 0),
      totalBytes: Number(snap.data()?.totalBytes ?? 0),
    };
    tx.set(
      ref,
      {
        count: Math.max(0, current.count - 1),
        totalBytes: Math.max(0, current.totalBytes - bytesToRelease),
      },
      { merge: true },
    );
  });
}

/** Truth-up the bytes counter when finalize confirms the actual object size. */
export async function recordFinalizedBytes(
  uid: string,
  bytes: number,
): Promise<void> {
  if (bytes <= 0) return;
  const clamped = Math.min(bytes, CUSTOM_SAMPLE_MAX_ENCODED_BYTES);
  const ref = db.collection("userQuotas").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.totalBytes ?? 0) : 0;
    tx.set(ref, { totalBytes: current + clamped }, { merge: true });
  });
}
