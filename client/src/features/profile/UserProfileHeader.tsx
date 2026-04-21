import { useState } from "react";
import type { User } from "@beats/shared";
import { api } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

interface Props {
  user: User;
  editable: boolean;
}

export function UserProfileHeader({ user, editable }: Props) {
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(user.bio);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [isPublic, setIsPublic] = useState(user.isPublic);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch<User>("/users/me", { bio, displayName, isPublic });
      pushToast("success", "profile updated");
      setEditing(false);
    } catch {
      pushToast("error", "update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="border border-grid rounded bg-bg-panel/60 p-4 space-y-3">
      {editing ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              name
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full h-9 px-2 bg-bg-panel border border-grid rounded text-ink font-mono text-sm"
              maxLength={80}
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              bio
            </span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full px-2 py-1 bg-bg-panel border border-grid rounded text-ink font-mono text-sm resize-none"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-ink-dim">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="accent-neon-green"
            />
            public profile (your tracks visible in gallery)
          </label>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "saving…" : "save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1
              className="text-neon-violet text-2xl tracking-[0.3em] uppercase"
              style={{ textShadow: "var(--glow-violet)" }}
            >
              {user.displayName}
            </h1>
            <p className="text-ink-muted text-[10px] uppercase tracking-widest">
              joined {new Date(user.createdAt).toLocaleDateString()}
              {user.isPublic && (
                <span className="ml-2 text-neon-green">● public</span>
              )}
            </p>
            {user.bio && (
              <p className="text-ink-dim text-sm max-w-xl">{user.bio}</p>
            )}
          </div>
          {editable && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              edit
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
