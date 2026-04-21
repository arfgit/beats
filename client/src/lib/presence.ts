import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export interface PresenceState {
  uid: string;
  displayName: string;
  color: string;
  focusedTrackId: string | null;
  focusedStep: number | null;
  updatedAt: number;
}

const STALE_AFTER_MS = 10_000;

/**
 * Subscribes to the presence subcollection for a project, filtering out
 * the caller's own entry and stale heartbeats. Returns an unsubscribe.
 */
export function subscribeToPresence(
  projectId: string,
  selfUid: string,
  onPeers: (peers: PresenceState[]) => void,
): () => void {
  return onSnapshot(
    collection(db, "projects", projectId, "presence"),
    (snap) => {
      const now = Date.now();
      const peers = snap.docs
        .map((d) => d.data() as PresenceState)
        .filter((p) => p.uid !== selfUid)
        .filter((p) => now - p.updatedAt < STALE_AFTER_MS);
      onPeers(peers);
    },
  );
}

export async function writePresence(
  projectId: string,
  state: PresenceState,
): Promise<void> {
  await setDoc(doc(db, "projects", projectId, "presence", state.uid), {
    ...state,
    updatedAt: Date.now(),
    serverUpdatedAt: serverTimestamp(),
  });
}

export async function clearPresence(
  projectId: string,
  uid: string,
): Promise<void> {
  await deleteDoc(doc(db, "projects", projectId, "presence", uid)).catch(
    () => undefined,
  );
}

const PEER_COLORS = [
  "#ff2a6d",
  "#05d9e8",
  "#b84dff",
  "#ffb800",
  "#39ff14",
  "#ff3864",
  "#e8e2ff",
];

export function pickPeerColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++)
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]!;
}
