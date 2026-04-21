import { useBeatsStore } from "@/store/useBeatsStore";

export default function StudioRoute() {
  const status = useBeatsStore((s) => s.auth.status);

  return (
    <div className="py-12">
      <h1
        className="text-neon-cyan text-2xl tracking-[0.4em] uppercase mb-2"
        style={{ textShadow: "var(--glow-cyan)" }}
      >
        studio
      </h1>
      <p className="text-ink-dim text-sm mb-8">
        pattern editor lands in phase 2b.
      </p>

      <div className="border border-grid rounded bg-bg-panel/60 p-8">
        <div className="grid grid-cols-8 gap-2 mb-4">
          {Array.from({ length: 32 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square border border-grid rounded bg-bg-panel-2/40"
            />
          ))}
        </div>
        <p className="text-ink-muted text-xs uppercase tracking-widest">
          {status === "authed"
            ? "signed in — ready to build"
            : "sign in to save your work"}
        </p>
      </div>
    </div>
  );
}
