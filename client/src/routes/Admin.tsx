import { useBeatsStore } from "@/store/useBeatsStore";

export default function AdminRoute() {
  const user = useBeatsStore((s) => s.auth.user);

  if (!user || user.role !== "admin") {
    return (
      <div className="py-12">
        <p className="text-neon-red text-sm">403 — admin only.</p>
      </div>
    );
  }

  return (
    <div className="py-12">
      <h1
        className="text-neon-sun text-2xl tracking-[0.4em] uppercase mb-2"
        style={{ textShadow: "0 0 10px rgba(255, 184, 0, 0.5)" }}
      >
        admin
      </h1>
      <p className="text-ink-dim text-sm">admin tools land in phase 8.</p>
    </div>
  );
}
