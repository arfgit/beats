import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "../lib/logger.js";

function init() {
  if (getApps().length > 0) return;

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
  // In the Firebase Functions gen-2 / Cloud Run runtime, credentials come
  // from the attached service account via the metadata server — no env var
  // is set, and `applicationDefault()` discovers them automatically. Detect
  // the runtime so we don't require the dev-only GOOGLE_APPLICATION_CREDENTIALS.
  const isInManagedRuntime =
    !!process.env.FUNCTION_TARGET || !!process.env.K_SERVICE;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
      storageBucket,
    });
    logger.info({ projectId }, "firebase-admin initialized from env JSON");
    return;
  }

  if (credentialsPath || isInManagedRuntime) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
      storageBucket,
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
  initializeApp({ projectId, storageBucket });
  logger.warn(
    { projectId },
    "firebase-admin initialized without credentials (emulator mode)",
  );
}

init();

export const adminAuth = getAuth();
export const db = getFirestore();
export const storage = getStorage();
