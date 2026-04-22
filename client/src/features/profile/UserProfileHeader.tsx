import { useMemo, useState } from "react";
import type { User } from "@beats/shared";
import { validateDisplayName, validateEmail } from "@beats/shared";
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

  // Live validation — same rules the server enforces via shared helper.
  // Empty edit state (nothing typed yet) surfaces as "not valid" which
  // disables save; that's fine because the form is pre-populated with
  // the current valid name.
  const nameValidation = useMemo(
    () => validateDisplayName(displayName),
    [displayName],
  );
  const emailValidation = useMemo(
    () => validateEmail(user.email),
    [user.email],
  );

  const save = async () => {
    if (!nameValidation.valid) {
      pushToast("error", nameValidation.reason ?? "check your display name");
      return;
    }
    setSaving(true);
    try {
      await api.patch<User>("/users/me", { bio, displayName, isPublic });
      pushToast("success", "profile updated");
      setEditing(false);
    } catch (err) {
      // Server-side validation echoes the same messages, so forward them.
      const message =
        err && typeof err === "object" && "apiError" in err
          ? ((err as { apiError: { message: string } }).apiError.message ??
            "update failed")
          : "update failed";
      pushToast("error", message);
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
              aria-invalid={!nameValidation.valid}
              aria-describedby="name-error"
              className={`mt-1 w-full h-9 px-2 bg-bg-panel border rounded text-ink font-mono text-sm ${
                nameValidation.valid ? "border-grid" : "border-neon-red"
              }`}
              maxLength={80}
            />
            {!nameValidation.valid && (
              <span
                id="name-error"
                className="mt-1 block text-[10px] text-neon-red"
              >
                {nameValidation.reason}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
              email
            </span>
            <input
              value={user.email}
              readOnly
              aria-readonly
              aria-invalid={!emailValidation.valid}
              className="mt-1 w-full h-9 px-2 bg-bg-panel-2 border border-grid rounded text-ink-muted font-mono text-sm cursor-not-allowed"
            />
            <span className="mt-1 block text-[10px] text-ink-muted">
              tied to your google sign-in — change by switching accounts
              {!emailValidation.valid && (
                <span className="ml-2 text-neon-red">
                  ({emailValidation.reason})
                </span>
              )}
            </span>
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
            <Button
              onClick={() => void save()}
              disabled={saving || !nameValidation.valid}
            >
              {saving ? "saving…" : "save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-ink text-lg tracking-[0.2em] font-normal">
              <span className="text-neon-violet">/</span> {user.displayName}
            </h1>
            {editable && user.email && (
              <p className="text-ink-muted text-[11px] font-mono">
                {user.email}
              </p>
            )}
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
