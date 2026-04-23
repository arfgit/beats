// Use || instead of ?? for every string config value. Vite sets env vars to
// the empty string "" when the key exists but has no value in .env.local
// (e.g. `VITE_FIREBASE_AUTH_DOMAIN=`). Nullish-coalescing ?? only falls
// through on null/undefined — the empty string passes straight through and
// Firebase then uses "" as the authDomain, which resolves /__/auth/handler
// as a relative URL on localhost and causes a 404 on sign-in.
const projectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID || "beats-prod-ant";

export const env = {
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain:
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
      `${projectId}.firebaseapp.com`,
    projectId,
    // Default to the modern `.firebasestorage.app` bucket (that's where
    // we seed samples). Firebase SDK's own fallback is `<id>.appspot.com`,
    // which on newer projects is the WRONG bucket and triggers 404 + CORS.
    storageBucket:
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
      `${projectId}.firebasestorage.app`,
    messagingSenderId:
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  },
  useEmulators: import.meta.env.VITE_USE_EMULATORS === "true",
  apiBase: import.meta.env.VITE_API_BASE ?? "/api",
  // Debug flag: when set, every sample URL resolves to this literal URL
  // instead of Firebase Storage. Use to isolate "is the audio graph broken?"
  // from "is the Storage fetch broken?". Pick a CORS-friendly MP3/WAV, e.g.
  //   VITE_AUDIO_HARDWIRE_URL=https://tonejs.github.io/audio/drum-samples/4OP-FM/kick.mp3
  audioHardwireUrl: import.meta.env.VITE_AUDIO_HARDWIRE_URL ?? "",
} as const;
