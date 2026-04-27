import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  DEFAULT_SESSION_PERMISSIONS,
  type MixerCell,
  type TrackKind,
} from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoIcon } from "@/components/ui/InfoIcon";

// Tiny dot colors for the per-cell step preview. Matches the main
// TrackRow palette so the eye reads "this cell has a kick on 1+5, snare
// on 3+7" at a glance without needing to click in.
const KIND_DOT: Record<TrackKind, string> = {
  drums: "bg-neon-magenta",
  bass: "bg-neon-sun",
  guitar: "bg-neon-cyan",
  vocals: "bg-neon-violet",
  fx: "bg-neon-green",
  custom: "bg-[#ff8c69]",
};

/**
 * 3×3 universal matrix of mixer cells. Each cell is:
 *   - Clickable → becomes the currently-edited cell (pattern grid below
 *     mirrors the selected cell's contents).
 *   - Toggleable → enabled cells participate in the Universal Play loop.
 *   - Draggable → dragging a cell onto another reorders via splice. The
 *     active/selected cells follow the cell by id, not by index, so a
 *     reorder while playing doesn't skip the beat.
 *   - Live-highlighted → the cell currently being played by the matrix
 *     transport gets a neon glow border. Keyboard users can focus a cell
 *     via Tab and toggle it with Space, or shift it with Alt+Arrow.
 */
export function MatrixGrid() {
  const cells = useBeatsStore((s) => s.matrix.cells);
  const selectedCellId = useBeatsStore((s) => s.selectedCellId);
  const activeCellId = useBeatsStore((s) => s.activeCellId);
  const setSelectedCellId = useBeatsStore((s) => s.setSelectedCellId);
  const toggleCellEnabled = useBeatsStore((s) => s.toggleCellEnabled);
  const reorderCells = useBeatsStore((s) => s.reorderCells);
  const generateDemoBeat = useBeatsStore((s) => s.generateDemoBeat);
  const clearAllCellSteps = useBeatsStore((s) => s.clearAllCellSteps);
  const toggleAllCellsEnabled = useBeatsStore((s) => s.toggleAllCellsEnabled);
  const setCellName = useBeatsStore((s) => s.setCellName);
  const anyCellEnabled = useBeatsStore((s) =>
    s.matrix.cells.some((c) => c.enabled),
  );
  // Live-session presence — pluck the focus.cellId from every active
  // peer so we can paint their color on whatever cell they're sitting
  // on. Selectors are kept primitive (single store-stable references
  // each); the derived object is built in `useMemo`. Returning a new
  // object straight from a Zustand selector trips React 18's strict
  // useSyncExternalStore consistency check (error #185 — "max update
  // depth exceeded") because each render produces a new identity even
  // when no state changed.
  const sessionId = useBeatsStore((s) => s.collab.session.id);
  const sessionMeta = useBeatsStore((s) => s.collab.session.meta);
  const sessionPresence = useBeatsStore((s) => s.collab.session.presence);
  const sessionParticipants = useBeatsStore(
    (s) => s.collab.session.participants,
  );
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);
  // Live-session flag drives "disable destructive ops" gating: seed
  // demo bulk-replaces the matrix without per-step EditOps so peers
  // wouldn't see it; clearing during a jam is a foot-gun. Both still
  // behind a confirm modal in solo mode but blocked entirely in collab.
  const inSession = sessionId !== null;
  // Invitee = in a session but not the host. When the host has locked
  // global actions (default), invitees see disabled clear/enable-all
  // controls with a "host locked" tooltip. The host can flip the toggle
  // live from SaveShareBar; metaHandler streams the change here.
  const isInviteeInSession =
    inSession && !!sessionMeta && sessionMeta.ownerUid !== myUid;
  const inviteesCanEditGlobal =
    sessionMeta?.permissions?.inviteesCanEditGlobal ??
    DEFAULT_SESSION_PERMISSIONS.inviteesCanEditGlobal;
  const globalActionsLocked = isInviteeInSession && !inviteesCanEditGlobal;
  const [showClearModal, setShowClearModal] = useState(false);
  const peerFocusByCell = useMemo(() => {
    const out: Record<
      string,
      Array<{ uid: string; color: string; name: string }>
    > = {};
    if (!sessionId) return out;
    const now = Date.now();
    for (const [uid, p] of Object.entries(sessionPresence)) {
      if (uid === myUid) continue;
      if (!p?.focus?.cellId) continue;
      // Treat the participants list as the source of truth for "is
      // this peer in the session right now". The lastSeen filter
      // (15s window) only kicks out ghost records that linger after
      // an ungraceful disconnect — onDisconnect should clean those
      // up, but we defend against the rare edge case anyway.
      if (!sessionParticipants[uid]) continue;
      if (now - (p.lastSeen ?? 0) > 15_000) continue;
      const participant = sessionParticipants[uid];
      const color = participant?.color ?? p.color ?? "#b84dff";
      const name = participant?.displayName ?? p.displayName ?? "peer";
      const cellId = p.focus.cellId;
      const list = out[cellId] ?? [];
      list.push({ uid, color, name });
      out[cellId] = list;
    }
    return out;
  }, [sessionId, sessionPresence, sessionParticipants, myUid]);
  const [seeding, setSeeding] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const onDragStart = (index: number) => (evt: React.DragEvent) => {
    setDragFromIndex(index);
    evt.dataTransfer.effectAllowed = "move";
    // Firefox needs a non-empty payload to fire drop events.
    evt.dataTransfer.setData("text/plain", String(index));
  };

  const onDragEnd = () => {
    setDragFromIndex(null);
    setDragOverIndex(null);
  };

  const onDragOver = (index: number) => (evt: React.DragEvent) => {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const onDrop = (toIndex: number) => (evt: React.DragEvent) => {
    evt.preventDefault();
    const fromIndex = dragFromIndex;
    setDragFromIndex(null);
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;
    reorderCells(fromIndex, toIndex);
  };

  const onKeyDown = (index: number) => (evt: React.KeyboardEvent) => {
    // Alt+Arrow = shift this cell. Plain Enter/Space = toggle selection.
    if (evt.altKey && (evt.key === "ArrowLeft" || evt.key === "ArrowUp")) {
      evt.preventDefault();
      if (index > 0) reorderCells(index, index - 1);
    } else if (
      evt.altKey &&
      (evt.key === "ArrowRight" || evt.key === "ArrowDown")
    ) {
      evt.preventDefault();
      if (index < cells.length - 1) reorderCells(index, index + 1);
    }
  };

  return (
    <section
      className="border border-grid rounded bg-bg-panel/50 p-3 lg:p-4 space-y-2"
      aria-label="universal matrix"
    >
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-ink-muted text-xs uppercase tracking-widest">
            matrix
          </h2>
          <InfoIcon label="each cell is a full mixer. play cycles enabled cells in row-major order at every bar boundary. drag to reorder, click the dot to enable/disable." />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] uppercase tracking-widest text-ink-muted hidden lg:block">
            drag to reorder · click to edit · dot toggles
          </p>
          <Tooltip
            label={
              globalActionsLocked
                ? "host has locked matrix-wide actions for invitees"
                : anyCellEnabled
                  ? "disable every cell in the matrix"
                  : "enable every cell in the matrix"
            }
          >
            <button
              type="button"
              onClick={() => toggleAllCellsEnabled()}
              disabled={globalActionsLocked}
              className="h-7 px-2 rounded border border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet text-[10px] uppercase tracking-widest font-mono transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-grid disabled:hover:text-ink-muted"
            >
              {anyCellEnabled ? "disable all" : "enable all"}
            </button>
          </Tooltip>
          <Tooltip
            label={
              globalActionsLocked
                ? "host has locked matrix-wide actions for invitees"
                : "deactivate every step on every row in every cell"
            }
          >
            <button
              type="button"
              onClick={() => setShowClearModal(true)}
              disabled={globalActionsLocked}
              className="h-7 px-2 rounded border border-grid text-ink-muted hover:border-neon-red hover:text-neon-red text-[10px] uppercase tracking-widest font-mono transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-grid disabled:hover:text-ink-muted"
            >
              clear matrix
            </button>
          </Tooltip>
          <Tooltip
            label={
              globalActionsLocked
                ? "host has locked matrix-wide actions for invitees"
                : inSession
                  ? "seed demo is disabled while a live session is active"
                  : "overwrite the matrix with a pre-programmed 9-cell beat"
            }
          >
            <button
              type="button"
              onClick={() => setShowSeedModal(true)}
              disabled={seeding || inSession || globalActionsLocked}
              className="h-7 px-2 rounded border border-neon-violet/70 text-neon-violet text-[10px] uppercase tracking-widest font-mono hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {seeding ? "seeding…" : "seed demo ✨"}
            </button>
          </Tooltip>
          {showSeedModal && (
            <SeedConfirmModal
              onConfirm={async () => {
                setShowSeedModal(false);
                setSeeding(true);
                try {
                  await generateDemoBeat();
                } finally {
                  setSeeding(false);
                }
              }}
              onCancel={() => setShowSeedModal(false)}
            />
          )}
          {showClearModal && (
            <ClearMatrixConfirmModal
              onConfirm={() => {
                setShowClearModal(false);
                clearAllCellSteps();
              }}
              onCancel={() => setShowClearModal(false)}
            />
          )}
        </div>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell, index) => {
          const isSelected = cell.id === selectedCellId;
          const isActive = cell.id === activeCellId;
          const isDragOver = dragOverIndex === index && dragFromIndex !== index;
          const peersHere = peerFocusByCell[cell.id] ?? [];
          // Use the FIRST peer's color for the cell's tinted ring so
          // the dominant collaborator is obvious at a glance. The full
          // list still renders as stacked dots in the corner.
          const primaryPeerColor = peersHere[0]?.color ?? null;
          const stepsActive = cell.pattern.tracks.reduce(
            (sum, t) => sum + t.steps.filter((s) => s.active).length,
            0,
          );
          return (
            <div
              key={cell.id}
              draggable
              onDragStart={onDragStart(index)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver(index)}
              onDrop={onDrop(index)}
              onKeyDown={onKeyDown(index)}
              onClick={() => setSelectedCellId(cell.id)}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`cell ${index + 1}${cell.enabled ? " enabled" : " disabled"}${isActive ? " playing" : ""}${isSelected ? " selected" : ""}${peersHere.length > 0 ? ` · ${peersHere.map((p) => p.name).join(", ")} editing here` : ""}`}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedCellId(cell.id);
                }
              }}
              style={
                primaryPeerColor && !isSelected
                  ? {
                      // Subtle tint when a peer is here but we're not.
                      // Selected (violet) wins on visual priority — the
                      // user's own focus is what they care about most.
                      boxShadow: `inset 0 0 0 2px ${primaryPeerColor}, 0 0 12px ${primaryPeerColor}40`,
                    }
                  : undefined
              }
              className={clsx(
                "relative cursor-grab active:cursor-grabbing select-none rounded border p-2 h-28 lg:h-32",
                "flex flex-col",
                "transition-[border-color,background-color,box-shadow] duration-200 ease-in",
                "motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet focus-visible:ring-offset-2 focus-visible:ring-offset-bg-panel",
                isSelected
                  ? "border-neon-violet bg-neon-violet/10"
                  : cell.enabled
                    ? "border-grid hover:border-ink-muted bg-bg-panel-2"
                    : "border-dashed border-grid/60 bg-bg-panel-2/60",
                isActive &&
                  "ring-2 ring-neon-cyan ring-offset-2 ring-offset-bg-panel",
                isDragOver && "border-neon-sun border-dashed",
              )}
            >
              {peersHere.length > 0 && (
                <div
                  className="absolute -top-1.5 -right-1.5 flex flex-row-reverse items-center gap-[-4px] z-10 pointer-events-none"
                  aria-hidden
                >
                  {peersHere.slice(0, 3).map((p, i) => (
                    <span
                      key={p.uid}
                      title={p.name}
                      style={{
                        backgroundColor: p.color,
                        marginLeft: i === 0 ? 0 : -4,
                        boxShadow: `0 0 6px ${p.color}, 0 0 0 1.5px var(--color-bg-panel, #0a0518)`,
                      }}
                      className="inline-block h-2.5 w-2.5 rounded-full"
                    />
                  ))}
                  {peersHere.length > 3 && (
                    <span
                      className="ml-0.5 text-[8px] font-mono text-ink-muted leading-none"
                      title={peersHere
                        .slice(3)
                        .map((p) => p.name)
                        .join(", ")}
                    >
                      +{peersHere.length - 3}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-start justify-between gap-1">
                {/* Drag handle — always visible so the affordance is clear */}
                <span
                  aria-hidden
                  className="text-[8px] text-ink-muted/40 font-mono leading-none pt-0.5 shrink-0 select-none"
                >
                  ⠿
                </span>
                <input
                  type="text"
                  defaultValue={cell.name ?? ""}
                  placeholder={String(index + 1)}
                  maxLength={24}
                  aria-label={`cell ${index + 1} name`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next !== (cell.name ?? null)) {
                      setCellName(cell.id, e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = cell.name ?? "";
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-0 flex-1 min-w-0 bg-transparent px-0.5 font-mono text-[10px] uppercase tracking-widest text-ink placeholder:text-ink-muted placeholder:normal-case focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon-violet rounded-sm"
                />
                <Tooltip label={cell.enabled ? "disable cell" : "enable cell"}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCellEnabled(cell.id);
                    }}
                    aria-pressed={cell.enabled}
                    aria-label={
                      cell.enabled
                        ? `disable cell ${index + 1}`
                        : `enable cell ${index + 1}`
                    }
                    className={clsx(
                      "h-4 w-4 rounded-full border",
                      "transition-colors duration-200 ease-in motion-reduce:transition-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet",
                      cell.enabled
                        ? "bg-neon-green border-neon-green"
                        : "bg-transparent border-grid hover:border-ink-muted",
                    )}
                  />
                </Tooltip>
              </div>
              <CellPreview cell={cell} />
              {peersHere.length > 0 && (
                <div
                  className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full px-1.5 py-0.5 backdrop-blur-sm"
                  style={{
                    backgroundColor: `${peersHere[0]!.color}22`,
                    boxShadow: `inset 0 0 0 1px ${peersHere[0]!.color}`,
                  }}
                  aria-hidden
                >
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: peersHere[0]!.color }}
                  />
                  <span
                    className="truncate font-mono text-[9px] uppercase tracking-widest"
                    style={{ color: peersHere[0]!.color }}
                  >
                    {peersHere[0]!.name}
                    {peersHere.length > 1 && ` +${peersHere.length - 1}`}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-ink-muted font-mono">
                  {stepsActive}/32
                </span>
                {isActive && (
                  <span
                    aria-hidden
                    className="text-[9px] uppercase tracking-widest text-neon-cyan animate-pulse"
                  >
                    ● live
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Mini 4-row × 8-col step preview for a single mixer cell. Each dot is
 * colored when the step is active (by track kind) and dim when not. Gives
 * the user a visual of what they've programmed in each cell before they
 * click in to edit — no guessing which cell has the kick pattern vs. the
 * bass line.
 */
/**
 * Confirmation modal for "seed demo". Uses the native <dialog> element so
 * focus is trapped inside the modal automatically and the browser handles
 * ESC → cancel without any custom key-listener. createPortal hoists it above
 * the matrix stacking context so it's never clipped.
 */
function SeedConfirmModal({
  onConfirm,
  onCancel,
}: {
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
        "fixed m-auto rounded-lg border border-grid bg-bg-panel p-6 shadow-xl shadow-black/60",
        "w-full max-w-sm",
        "backdrop:bg-bg-void/75 backdrop:backdrop-blur-sm",
        "focus-visible:outline-none",
      )}
    >
      <h3
        id={titleId}
        className="mb-1 font-mono text-sm uppercase tracking-widest text-ink"
      >
        overwrite matrix?
      </h3>
      <p className="mb-5 text-[11px] text-ink-muted">
        All 9 cells will be replaced with a pre-programmed demo beat. This
        cannot be undone.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded border border-grid font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-8 px-3 rounded border border-neon-violet/70 font-mono text-[10px] uppercase tracking-widest text-neon-violet hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet"
        >
          overwrite
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * Confirmation for "clear matrix" — same dialog pattern as the seed
 * confirm but with destructive copy + a red action button. Especially
 * important in collab mode (mis-click would wipe everyone's work) but
 * worth a confirm in solo too since the action is irreversible.
 */
function ClearMatrixConfirmModal({
  onConfirm,
  onCancel,
}: {
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
        clear matrix?
      </h3>
      <p className="mb-5 text-[11px] text-ink-muted">
        Every step in every cell of every row will be deactivated. This cannot
        be undone.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="h-8 px-3 rounded border border-grid font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-8 px-3 rounded border border-neon-red/70 font-mono text-[10px] uppercase tracking-widest text-neon-red hover:bg-neon-red/10 transition-colors duration-200 ease-in motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-red"
        >
          clear
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

function CellPreview({ cell }: { cell: MixerCell }) {
  const stepCount = cell.pattern.stepCount;
  return (
    <div
      aria-hidden
      className="flex-1 my-1 grid gap-[2px]"
      style={{
        gridTemplateRows: `repeat(${cell.pattern.tracks.length}, minmax(0, 1fr))`,
      }}
    >
      {cell.pattern.tracks.map((track) => (
        <div
          key={track.id}
          className="grid gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${stepCount}, minmax(0, 1fr))`,
          }}
        >
          {track.steps.map((step, i) => (
            <div
              key={i}
              className={clsx(
                "rounded-[1px]",
                step.active
                  ? KIND_DOT[track.kind]
                  : "bg-bg-panel border border-grid/40",
              )}
              style={{
                opacity: step.active ? 0.4 + step.velocity * 0.6 : 1,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
