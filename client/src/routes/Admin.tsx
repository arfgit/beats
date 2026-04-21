import { useBeatsStore } from "@/store/useBeatsStore";
import { AdminTable } from "@/features/admin/AdminTable";

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
    <div className="py-8 space-y-6">
      <header>
        <h1
          className="text-neon-sun text-2xl tracking-[0.4em] uppercase"
          style={{ textShadow: "0 0 10px rgba(255, 184, 0, 0.5)" }}
        >
          admin
        </h1>
        <p className="text-ink-muted text-xs uppercase tracking-widest mt-1">
          users and projects moderation
        </p>
      </header>
      <AdminTable />
    </div>
  );
}
