import { useBeatsStore } from "@/store/useBeatsStore";

export default function ProfileRoute() {
  const user = useBeatsStore((s) => s.auth.user);
  const status = useBeatsStore((s) => s.auth.status);

  return (
    <div className="py-12 space-y-4">
      <h1
        className="text-neon-violet text-2xl tracking-[0.4em] uppercase"
        style={{ textShadow: "var(--glow-violet)" }}
      >
        profile
      </h1>
      {status !== "authed" || !user ? (
        <p className="text-ink-dim text-sm">sign in to view your profile.</p>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-4 text-sm font-mono">
          <dt className="text-ink-muted uppercase tracking-widest text-xs">
            name
          </dt>
          <dd className="text-ink">{user.displayName}</dd>
          <dt className="text-ink-muted uppercase tracking-widest text-xs">
            email
          </dt>
          <dd className="text-ink">{user.email}</dd>
          <dt className="text-ink-muted uppercase tracking-widest text-xs">
            role
          </dt>
          <dd className="text-ink">{user.role}</dd>
          <dt className="text-ink-muted uppercase tracking-widest text-xs">
            joined
          </dt>
          <dd className="text-ink">
            {new Date(user.createdAt).toLocaleDateString()}
          </dd>
        </dl>
      )}
    </div>
  );
}
