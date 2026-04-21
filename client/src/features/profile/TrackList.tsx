import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { UploadedTrack } from "@beats/shared";
import { db } from "@/lib/firebase";

interface Props {
  ownerId: string;
}

interface TrackWithStatus extends UploadedTrack {
  status?: "pending" | "ready";
}

export function TrackList({ ownerId }: Props) {
  const [tracks, setTracks] = useState<TrackWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "uploadedTracks"),
      where("ownerId", "==", ownerId),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTracks(snap.docs.map((d) => d.data() as TrackWithStatus));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [ownerId]);

  if (loading) {
    return (
      <p className="text-ink-muted text-xs uppercase tracking-widest">
        loading tracks…
      </p>
    );
  }
  if (tracks.length === 0) {
    return (
      <p className="text-ink-muted text-xs">
        no recordings yet — hit rec in the studio.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {tracks.map((track) => (
        <li
          key={track.id}
          className="border border-grid rounded bg-bg-panel/60 p-3 flex items-center justify-between"
        >
          <div className="space-y-0.5">
            <p className="text-ink font-mono text-sm truncate">{track.title}</p>
            <p className="text-ink-muted text-[10px] uppercase tracking-widest">
              {formatDuration(track.durationMs)} ·{" "}
              {new Date(track.createdAt).toLocaleDateString()}
              {track.status === "pending" && " · upload pending"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
