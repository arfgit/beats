import { useEffect, useState } from "react";
import type { Project, User } from "@beats/shared";
import { api, ApiCallError } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";

type Tab = "users" | "projects";

export function AdminTable() {
  const [tab, setTab] = useState<Tab>("users");
  const pushToast = useBeatsStore((s) => s.pushToast);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      try {
        if (tab === "users") setUsers(await api.get<User[]>("/admin/users"));
        else setProjects(await api.get<Project[]>("/admin/projects"));
      } catch (err) {
        const message =
          err instanceof ApiCallError ? err.apiError.message : "load failed";
        pushToast("error", message);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tab, pushToast]);

  const promote = async (uid: string, role: "user" | "admin") => {
    try {
      const updated = await api.patch<User>(`/admin/users/${uid}`, { role });
      setUsers((prev) => prev.map((u) => (u.id === uid ? updated : u)));
      pushToast("success", `${uid} → ${role}`);
    } catch {
      pushToast("error", "update failed");
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.delete<{ ok: true }>(`/admin/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      pushToast("success", "project removed");
    } catch {
      pushToast("error", "delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <nav className="flex gap-1" role="tablist">
        {(["users", "projects"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "px-3 py-1.5 text-[10px] uppercase tracking-widest text-neon-sun border-b-2 border-neon-sun"
                : "px-3 py-1.5 text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink-dim"
            }
          >
            {t}
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="text-ink-muted text-xs uppercase tracking-widest">
          loading…
        </p>
      ) : tab === "users" ? (
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-widest text-[10px] border-b border-grid">
              <th className="text-left py-2">name</th>
              <th className="text-left py-2">email</th>
              <th className="text-left py-2">role</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-grid/40">
                <td className="py-2 text-ink">{u.displayName}</td>
                <td className="py-2 text-ink-dim">{u.email}</td>
                <td className="py-2 text-neon-cyan">{u.role}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void promote(u.id, u.role === "admin" ? "user" : "admin")
                    }
                  >
                    {u.role === "admin" ? "demote" : "promote"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-widest text-[10px] border-b border-grid">
              <th className="text-left py-2">title</th>
              <th className="text-left py-2">owner</th>
              <th className="text-left py-2">public</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-grid/40">
                <td className="py-2 text-ink">{p.title}</td>
                <td className="py-2 text-ink-dim">{p.ownerId}</td>
                <td className="py-2 text-neon-cyan">
                  {p.isPublic ? "yes" : "no"}
                </td>
                <td className="py-2 text-right">
                  <Button
                    variant="danger"
                    onClick={() => void deleteProject(p.id)}
                  >
                    delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
