import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { Project } from "@beats/shared";
import { db } from "@/lib/firebase";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";

export function ProjectList() {
  const uid = useBeatsStore((s) => s.auth.user?.id);
  const [mine, setMine] = useState<Project[]>([]);
  const [shared, setShared] = useState<Project[]>([]);

  useEffect(() => {
    if (!uid) return;
    const mineQ = query(
      collection(db, "projects"),
      where("ownerId", "==", uid),
      orderBy("updatedAt", "desc"),
      limit(10),
    );
    const unsubMine = onSnapshot(mineQ, (snap) =>
      setMine(snap.docs.map((d) => d.data() as Project)),
    );

    const sharedQ = query(
      collection(db, "projects"),
      where("collaboratorIds", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(10),
    );
    const unsubShared = onSnapshot(sharedQ, (snap) =>
      setShared(snap.docs.map((d) => d.data() as Project)),
    );

    return () => {
      unsubMine();
      unsubShared();
    };
  }, [uid]);

  if (!uid) return null;

  return (
    <aside className="border border-grid rounded p-3 bg-bg-panel/60 space-y-3 text-xs font-mono">
      <Section title="my projects" projects={mine} />
      <Section
        title="shared with me"
        projects={shared}
        empty="no shared projects yet"
      />
    </aside>
  );
}

function Section({
  title,
  projects,
  empty = "nothing yet",
}: {
  title: string;
  projects: Project[];
  empty?: string;
}) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">
        {title}
      </h3>
      {projects.length === 0 ? (
        <p className="text-ink-muted text-[10px]">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.id}>
              <Tooltip
                label={`last saved ${new Date(p.updatedAt).toLocaleString()}`}
              >
                <Link
                  to={`/studio/${p.id}`}
                  className="block px-2 py-1 rounded text-ink-dim hover:text-neon-cyan hover:bg-bg-panel-2/60 transition-colors duration-150"
                >
                  <span className="truncate">{p.title}</span>
                  {p.isPublic && (
                    <span className="ml-2 text-[9px] text-neon-green">
                      ● public
                    </span>
                  )}
                </Link>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
