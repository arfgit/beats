import { normalizeUsername, validateUsername, type User } from "@beats/shared";
import { db } from "./firebase-admin.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";

/**
 * Username (public handle) reservation service. Uniqueness is enforced
 * by writing both `usernames/{lower}` and `users/{uid}.username` in a
 * single Firestore transaction — Firestore has no native unique-field
 * constraint, so the reservation doc IS the lock.
 *
 * v1 deletes the user's old reservation atomically on rename. The
 * 7-day freed-handle hold (squat protection) is on the v1.1 backlog.
 */

interface UsernameReservation {
  uid: string;
  claimedAt: number;
  /** Original casing the user picked, preserved for display. */
  original: string;
}

/**
 * Atomically claim a username for the given uid. Throws ValidationError
 * on bad format / reserved word, ConflictError on race or already-taken.
 * Idempotent only when the same user re-claims the same handle (returns
 * silently); a different requested value is treated as a rename.
 */
export async function claimUsername(
  uid: string,
  requested: string,
): Promise<User> {
  const validation = validateUsername(requested);
  if (!validation.ok) {
    throw ValidationError(validation.message, { code: validation.code });
  }
  const lower = validation.normalized;
  const original = requested.trim();
  const usernameRef = db.collection("usernames").doc(lower);
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const [usernameSnap, userSnap] = await Promise.all([
      tx.get(usernameRef),
      tx.get(userRef),
    ]);

    if (!userSnap.exists) {
      throw NotFoundError("user not found");
    }
    const user = userSnap.data() as User;

    // Idempotent: same user re-claiming the same lowercased handle
    // updates the original-casing field but doesn't churn ownership.
    if (usernameSnap.exists) {
      const existing = usernameSnap.data() as UsernameReservation;
      if (existing.uid !== uid) {
        throw ConflictError("username already taken");
      }
      // Same uid + same lower → just refresh `original` to match new
      // requested casing. Skip the user.username write if unchanged.
      if (existing.original !== original) {
        tx.update(usernameRef, { original });
      }
      const userPatch: Partial<User> = { username: original };
      tx.update(userRef, userPatch);
      return { ...user, username: original, usernameLower: lower };
    }

    // Free the user's prior reservation if they're renaming. Same tx
    // so we never end up holding two reservations under one uid. Read
    // the old reservation first to lock it under the transaction —
    // otherwise two concurrent renames could both blind-delete and
    // leave the index inconsistent.
    if (user.usernameLower && user.usernameLower !== lower) {
      const oldRef = db.collection("usernames").doc(user.usernameLower);
      await tx.get(oldRef);
      tx.delete(oldRef);
    }

    const reservation: UsernameReservation = {
      uid,
      claimedAt: Date.now(),
      original,
    };
    tx.set(usernameRef, reservation);
    const userPatch: Partial<User> = {
      username: original,
      usernameLower: lower,
    };
    tx.update(userRef, userPatch);
    return { ...user, username: original, usernameLower: lower };
  });
}

/**
 * Cheap availability probe — single doc-exists read. Throttle at the
 * route layer; this function does no rate-limiting itself.
 *
 * Returns `{ available: false }` for invalid inputs too so the client
 * gets uniform feedback without leaking the validation message via this
 * endpoint (a separate `validate` step on the client surfaces the
 * specific reason).
 */
export async function isUsernameAvailable(requested: string): Promise<boolean> {
  const validation = validateUsername(requested);
  if (!validation.ok) return false;
  const snap = await db
    .collection("usernames")
    .doc(validation.normalized)
    .get();
  return !snap.exists;
}

/**
 * Resolve a public handle back to a uid. Used by the public profile
 * route GET /users/by-username/:handle.
 */
export async function lookupUsername(
  requested: string,
): Promise<string | null> {
  const lower = normalizeUsername(requested);
  if (!lower) return null;
  const snap = await db.collection("usernames").doc(lower).get();
  if (!snap.exists) return null;
  return (snap.data() as UsernameReservation).uid;
}
