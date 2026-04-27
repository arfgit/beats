import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import clsx from "clsx";
import type { Project } from "@beats/shared";
import { db } from "@/lib/firebase";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";

export function ProjectList() {
  const uid = useBeatsStore((s) => s.auth.user?.id);
  const deleteProject = useBeatsStore((s) => s.deleteProject);
  const liveSessionId = useBeatsStore((s) => s.collab.session.id);
  const sessionMetaProjectId = useBeatsStore(
    (s) => s.collab.session.meta?.projectId ?? null,
  );
  const navigate = useNavigate();
  const [mine, setMine] = useState<Project[]>([]);
  const [shared, setShared] = useState<Project[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleConfirmDelete = async () => {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    const ok = await deleteProject(pendingDelete.id);
    setIsDeleting(false);
    if (ok) setPendingDelete(null);
  };

  const handleGoLive = (p: Project) => {
    // Disallow starting a session on project A while you're already
    // hosting/joined on project B — would orphan the other peers and
    // leave the studio in an ambiguous state. The button is rendered
    // disabled for those rows; this is a defense-in-depth guard.
    if (liveSessionId && sessionMetaProjectId !== p.id) return;
    navigate(`/studio/${p.id}?goLive=1`);
  };

  return (
    <aside className="border border-grid rounded p-3 bg-bg-panel/60 space-y-3 text-xs font-mono">
      <Section
        title="my projects"
        projects={mine}
        canDelete
        canGoLive
        liveSessionProjectId={liveSessionId ? sessionMetaProjectId : null}
        onRequestDelete={(p) => setPendingDelete(p)}
        onRequestGoLive={handleGoLive}
      />
      <Section
        title="shared with me"
        projects={shared}
        empty="no shared projects yet"
      />
      {pendingDelete && (
        <DeleteProjectConfirmModal
          projectTitle={pendingDelete.title}
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            if (isDeleting) return;
            setPendingDelete(null);
          }}
        />
      )}
    </aside>
  );
}

function Section({
  title,
  projects,
  empty = "nothing yet",
  canDelete = false,
  canGoLive = false,
  liveSessionProjectId = null,
  onRequestDelete,
  onRequestGoLive,
}: {
  title: string;
  projects: Project[];
  empty?: string;
  canDelete?: boolean;
  canGoLive?: boolean;
  liveSessionProjectId?: string | null;
  onRequestDelete?: (project: Project) => void;
  onRequestGoLive?: (project: Project) => void;
}) {
  // When the user is already in a session, mute the go-live button on
  // OTHER rows — switching projects mid-session would orphan peers.
  // The current-project row instead shows a "live" indicator.
  const inSessionElsewhere = (projectId: string) =>
    liveSessionProjectId !== null && liveSessionProjectId !== projectId;
  // Right padding leaves room for the action buttons sitting on top of
  // the row link. With both go-live + delete, we need ~3rem.
  const linkPaddingRight =
    canGoLive && canDelete ? "pr-12" : canDelete ? "pr-7" : "";
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">
        {title}
      </h3>
      {projects.length === 0 ? (
        <p className="text-ink-muted text-[10px]">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {projects.map((p) => {
            const isLive = liveSessionProjectId === p.id;
            const otherSessionActive = inSessionElsewhere(p.id);
            return (
              <li key={p.id} className="relative">
                <Tooltip
                  label={`last saved ${new Date(p.updatedAt).toLocaleString()}`}
                >
                  <Link
                    to={`/studio/${p.id}`}
                    className={clsx(
                      "block px-2 py-1 rounded text-ink-dim hover:text-neon-cyan hover:bg-bg-panel-2/60 transition-colors duration-150",
                      linkPaddingRight,
                    )}
                  >
                    <span className="truncate">{p.title}</span>
                    {p.isPublic && (
                      <span className="ml-2 text-[9px] text-neon-green">
                        ● public
                      </span>
                    )}
                    {isLive && (
                      <span className="ml-2 text-[9px] uppercase tracking-widest text-neon-violet animate-pulse">
                        ● live
                      </span>
                    )}
                  </Link>
                </Tooltip>
                {canGoLive && onRequestGoLive && !isLive && (
                  <Tooltip
                    label={
                      otherSessionActive
                        ? "you're already live in another project — leave that session first"
                        : "start a live collab session on this project"
                    }
                  >
                    <button
                      type="button"
                      aria-label={`go live on ${p.title}`}
                      disabled={otherSessionActive}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (otherSessionActive) return;
                        onRequestGoLive(p);
                      }}
                      className="absolute top-1/2 right-7 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:text-neon-violet hover:bg-neon-violet/10 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-ink-muted disabled:hover:bg-transparent"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden
                      >
                        <path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
                {canDelete && onRequestDelete && (
                  <button
                    type="button"
                    aria-label={`delete project ${p.title}`}
                    title="delete project"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRequestDelete(p);
                    }}
                    className="absolute top-1/2 right-1 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:text-neon-red hover:bg-neon-red/10 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-red"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9h5L11 4M7 6.5v4.5M9 6.5v4.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeleteProjectConfirmModal({
  projectTitle,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  projectTitle: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby={titleId}
      className={clsx(
        "fixed m-auto rounded-lg border border-neon-red/70 bg-bg-panel p-6 shadow-xl shadow-black/60",
        "w-full max-w-sm",
        "backdrop:bg-bg-void/75 backdrop:backdrop-blur-sm",
        "focus-visible:outline-none",
      )}
    >
      <h3
        id={titleId}
        className="mb-1 font-mono text-sm uppercase tracking-widest text-neon-red"
      >
        delete project?
      </h3>
      <p className="mb-5 text-[11px] text-ink-muted break-words">
        <span className="text-ink">“{projectTitle}”</span> and all of its grid
        data will be permanently removed. Collaborators will lose access. This
        cannot be undone.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          disabled={isDeleting}
          className="h-8 px-3 rounded border border-grid font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet disabled:opacity-50 disabled:cursor-not-allowed"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDeleting}
          className="h-8 px-3 rounded border border-neon-red/70 font-mono text-[10px] uppercase tracking-widest text-neon-red hover:bg-neon-red/10 transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-red disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDeleting ? "deleting…" : "delete"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
