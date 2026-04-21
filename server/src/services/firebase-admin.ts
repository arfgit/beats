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
    "beats-dev-ant";
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
      storageBucket: `${projectId}.appspot.com`,
    });
    logger.info({ projectId }, "firebase-admin initialized from env JSON");
    return;
  }

  if (credentialsPath) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
      storageBucket: `${projectId}.appspot.com`,
    });
    logger.info(
      { projectId, credentialsPath },
      "firebase-admin initialized from ADC",
    );
    return;
  }

  // Emulator-only mode — no real credentials.
  initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  logger.warn(
    { projectId },
    "firebase-admin initialized without credentials (emulator mode)",
  );
}

init();

export const adminAuth = getAuth();
export const db = getFirestore();
export const storage = getStorage();
