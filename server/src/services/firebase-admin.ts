import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "../lib/logger.js";

function init() {
  if (getApps().length > 0) return;

  // Detect managed runtimes (Cloud Functions gen 2 / Cloud Run) BEFORE
  // we look at GOOGLE_APPLICATION_CREDENTIALS. If the deploying machine's
  // .env file got shipped with that path (which Firebase CLI does by
  // default — it loads .env values onto the function's runtime env),
  // the SDK would try to read a file that doesn't exist in the
  // container and crash with ENOENT before any handler runs. The
  // metadata server is the right credential source in managed runtimes
  // anyway, so we deliberately ignore the file-path var there.
  const isInManagedRuntime =
    !!process.env.FUNCTION_TARGET || !!process.env.K_SERVICE;
  if (isInManagedRuntime) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID ??
    "beats-prod-ant";
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  // The project was created with the modern `.firebasestorage.app` bucket;
  // the SDK's legacy fallback of `.appspot.com` is a different bucket that
  // doesn't exist on this project (leads to 404 + CORS failures).
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`;
  // Realtime Database URL — needed at init time so getDatabase() can
  // hand back a usable ref. Defaults to the canonical
  // `<projectId>-default-rtdb.firebaseio.com`; override via env for
  // non-default regions.
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ??
    `https://${projectId}-default-rtdb.firebaseio.com`;
  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
      storageBucket,
      databaseURL,
    });
    logger.info({ projectId }, "firebase-admin initialized from env JSON");
    return;
  }

  if (credentialsPath || isInManagedRuntime) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
      storageBucket,
      databaseURL,
    });
    logger.info(
      {
        projectId,
        source: credentialsPath ? "GOOGLE_APPLICATION_CREDENTIALS" : "metadata",
      },
      "firebase-admin initialized from ADC",
    );
    return;
  }

  // Emulator-only mode — no real credentials.
  initializeApp({ projectId, storageBucket, databaseURL });
  logger.warn(
    { projectId },
    "firebase-admin initialized without credentials (emulator mode)",
  );
}

init();

export const adminAuth = getAuth();
export const db = getFirestore();
export const storage = getStorage();
export const rtdb = getDatabase();
