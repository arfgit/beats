import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { env } from "./env";

// Surface a friendly, loud error if the config is missing before any
// Firebase call spins up and fails with an opaque network error.
if (!env.useEmulators && !env.firebase.apiKey) {
   
  console.error(
    "[firebase] VITE_FIREBASE_API_KEY is not set. Either:\n" +
      "  1) copy your web app config into client/.env.local from Firebase Console\n" +
      "     → Project Settings → Your apps → Web app, or\n" +
      "  2) set VITE_USE_EMULATORS=true and run `npm run emulators` in another terminal.",
  );
}

const app = getApps()[0] ?? initializeApp(env.firebase);

export const auth = getAuth(app);
// Force long-polling instead of the default WebChannel streaming
// transport. WebChannel uses XHR with `withCredentials: true`, which
// triggers the browser's "Access-Control-Allow-Origin: * is not allowed
// when credentials mode is include" rejection on the production
// Firestore endpoint. `experimentalAutoDetectLongPolling` only catches
// some failure modes; production reliably hits this CORS-wildcard one,
// so we skip the WebChannel handshake entirely and use the
// long-polling transport from the first request.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
export const storage = getStorage(app);
// Realtime Database — used exclusively for ephemeral collab session
// state (presence, edit log, snapshot). Project state stays canonical
// in Firestore; RTDB is a "fast lane" for the live channel only.
export const rtdb = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();

// Loud boot-time diagnostic. Easy to grep for in DevTools when data isn't
// showing up — the usual culprit is a stale VITE_USE_EMULATORS=true in
// .env.local pointing the studio at an empty local emulator.
 
console.info(
  `%c[firebase]%c mode=${env.useEmulators ? "EMULATOR" : "PRODUCTION"}  project=${env.firebase.projectId || "(unset)"}  apiKey=${env.firebase.apiKey ? "set" : "MISSING"}`,
  "color:#ff2a6d;font-weight:bold",
  "color:inherit",
);
 

if (env.useEmulators) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectStorageEmulator(storage, "localhost", 9199);
  connectDatabaseEmulator(rtdb, "localhost", 9000);
}
