import { Link } from "react-router-dom";
import type { Project } from "@beats/shared";
import { getProjectSummary } from "@beats/shared";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useBeatsStore } from "@/store/useBeatsStore";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface Props {
  project: Project;
  onForked?: (forkId: string) => void;
}

export function ProjectCard({ project, onForked }: Props) {
  const pushToast = useBeatsStore((s) => s.pushToast);
  const authed = useBeatsStore((s) => s.auth.status === "authed");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const fork = async () => {
    setBusy(true);
    try {
      const forked = await api.post<Project>(`/projects/${project.id}/fork`);
      pushToast("success", "forked into your projects");
      onForked?.(forked.id);
      navigate(`/studio/${forked.id}`);
    } catch {
      pushToast("error", "fork failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="border border-grid rounded bg-bg-panel/60 p-4 space-y-3 hover:border-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none">
      <Link to={`/studio/${project.id}`} className="block space-y-1">
        <h3
          className="text-ink text-sm font-mono truncate"
          style={{ textShadow: "0 0 4px rgba(184, 77, 255, 0.3)" }}
        >
          {project.title}
        </h3>
        <ProjectSummaryLine project={project} />
      </Link>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-muted">
          updated {new Date(project.updatedAt).toLocaleDateString()}
        </span>
        {authed && (
          <Button variant="ghost" onClick={() => void fork()} disabled={busy}>
            {busy ? "forking…" : "fork"}
          </Button>
        )}
      </div>
    </article>
  );
}

function ProjectSummaryLine({ project }: { project: Project }) {
  const summary = getProjectSummary(project.pattern);
  const parts = [
    `${summary.bpm} bpm`,
    `${summary.trackCount} tracks`,
    `${summary.effectsEnabled} fx on`,
  ];
  if (summary.enabledCellCount !== undefined) {
    parts.splice(2, 0, `${summary.enabledCellCount}/9 cells`);
  }
  return (
    <p className="text-ink-muted text-[10px] uppercase tracking-widest">
      {parts.join(" · ")}
    </p>
  );
}
