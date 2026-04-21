import { useEffect, useState } from "react";
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
import { ProjectCard } from "./ProjectCard";

export function GalleryGrid() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "projects"),
      where("isPublic", "==", true),
      orderBy("updatedAt", "desc"),
      limit(30),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProjects(snap.docs.map((d) => d.data() as Project));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  if (loading) {
    return (
      <p className="text-ink-muted text-xs uppercase tracking-widest">
        loading public beats…
      </p>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        nothing published yet — build something in studio and flip the public
        toggle.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
