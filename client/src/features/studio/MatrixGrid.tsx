import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { MixerCell, TrackKind } from "@beats/shared";
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
              anyCellEnabled
                ? "disable every cell in the matrix"
                : "enable every cell in the matrix"
            }
          >
            <button
              type="button"
              onClick={() => toggleAllCellsEnabled()}
              className="h-7 px-2 rounded border border-grid text-ink-muted hover:border-neon-violet hover:text-neon-violet text-[10px] uppercase tracking-widest font-mono transition-colors duration-200 ease-in motion-reduce:transition-none"
            >
              {anyCellEnabled ? "disable all" : "enable all"}
            </button>
          </Tooltip>
          <Tooltip label="deactivate every step on every row in every cell">
            <button
              type="button"
              onClick={() => clearAllCellSteps()}
              className="h-7 px-2 rounded border border-grid text-ink-muted hover:border-neon-red hover:text-neon-red text-[10px] uppercase tracking-widest font-mono transition-colors duration-200 ease-in motion-reduce:transition-none"
            >
              clear matrix
            </button>
          </Tooltip>
          <Tooltip label="overwrite the matrix with a pre-programmed 9-cell beat">
            <button
              type="button"
              onClick={() => setShowSeedModal(true)}
              disabled={seeding}
              className="h-7 px-2 rounded border border-neon-violet/70 text-neon-violet text-[10px] uppercase tracking-widest font-mono hover:bg-neon-violet/10 transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-50 disabled:cursor-wait"
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
        </div>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell, index) => {
          const isSelected = cell.id === selectedCellId;
          const isActive = cell.id === activeCellId;
          const isDragOver = dragOverIndex === index && dragFromIndex !== index;
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
              aria-label={`cell ${index + 1}${cell.enabled ? " enabled" : " disabled"}${isActive ? " playing" : ""}${isSelected ? " selected" : ""}`}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedCellId(cell.id);
                }
              }}
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
