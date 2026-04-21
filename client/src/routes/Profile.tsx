import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { User } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { api, ApiCallError } from "@/lib/api";
import { UserProfileHeader } from "@/features/profile/UserProfileHeader";
import { TrackList } from "@/features/profile/TrackList";

export default function ProfileRoute() {
  const { uid } = useParams<{ uid?: string }>();
  const selfUser = useBeatsStore((s) => s.auth.user);
  const status = useBeatsStore((s) => s.auth.status);
  const [viewed, setViewed] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || uid === selfUser?.id) {
      setViewed(selfUser);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const user = await api.get<User>(`/users/${uid}`);
        if (!cancelled) setViewed(user);
      } catch (err) {
        const message =
          err instanceof ApiCallError
            ? err.apiError.message
            : "profile not found";
        if (!cancelled) setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, selfUser]);

  if (status !== "authed" && !uid) {
    return (
      <div className="py-12">
        <p className="text-ink-dim text-sm">sign in to view your profile.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12">
        <p className="text-neon-red text-sm">{error}</p>
      </div>
    );
  }

  if (!viewed) {
    return (
      <div className="py-12">
        <p className="text-ink-muted text-xs uppercase tracking-widest">
          loading…
        </p>
      </div>
    );
  }

  const isSelf = selfUser?.id === viewed.id;

  return (
    <div className="py-8 space-y-6">
      <UserProfileHeader user={viewed} editable={isSelf} />
      <section className="space-y-3">
        <h2 className="text-ink-muted text-xs uppercase tracking-widest">
          tracks
        </h2>
        {isSelf || viewed.isPublic ? (
          <TrackList ownerId={viewed.id} />
        ) : (
          <p className="text-ink-muted text-xs">this profile is private.</p>
        )}
      </section>
    </div>
  );
}
