import type { Pattern, ProjectMatrix, MixerCell } from "@beats/shared";
import type { AudioEngine } from "./engine";

/**
 * Matrix sequencer layered on top of the single-pattern engine. Rather
 * than rewriting the engine to handle 36 voices + 9 effect chains (the
 * "full matrix transport" from the architecture doc), this controller
 * treats the matrix as a sequence of patterns: at each bar boundary it
 * advances `activeCellId` through the enabled cells and swaps the
 * engine's current pattern to the next cell's contents.
 *
 * Tradeoffs vs. the architect's full design:
 *   + Reuses existing 4-voice engine + single FX chain (simpler, tested)
 *   + Effects tail naturally continues across cell boundaries because the
 *     FX chain is shared at the master bus
 *   - A brief step-0-of-new-cell slip is possible because the step event
 *     fires after the audio thread has already started the next step;
 *     samples that weren't already cached may not fire on step 0 of a
 *     cell on its first visit. Fine for MVP, revisit with per-cell voices
 *     if users notice the slip.
 *
 * `playOrderIds` is latched when the matrix or enabled set changes so
 * reorders that happen mid-play take effect at the next full cycle, not
 * mid-bar — matches codex's "latched playOrder" recommendation.
 */

export type CellToPatternFn = (
  cell: MixerCell,
  matrix: ProjectMatrix,
) => Pattern;

export interface MatrixController {
  start: () => void;
  stop: () => void;
  setMatrix: (matrix: ProjectMatrix) => void;
  dispose: () => void;
}

export function createMatrixController(params: {
  engine: AudioEngine;
  getMatrix: () => ProjectMatrix;
  cellToPattern: CellToPatternFn;
  onCellChange: (cellId: string | null) => void;
  /**
   * Invoked with each cell's effective pattern view after it's installed.
   * Wires the existing sample-forwarding logic (see `forwardPatternSamples`
   * in bridge.ts) so voice buffers re-attach when the active cell changes
   * — without this hook the engine snapshot advances but voices keep the
   * previous cell's samples, and every cell sounds like cell 0.
   */
  onPatternInstalled?: (pattern: Pattern, previous: Pattern | null) => void;
}): MatrixController {
  const { engine, getMatrix, cellToPattern, onCellChange, onPatternInstalled } =
    params;
  let playOrderIds: string[] = [];
  let activeIndex = -1;
  let lastStep = -1;
  let stepUnsub: (() => void) | null = null;
  let isRunning = false;
  let lastInstalledPattern: Pattern | null = null;

  function latchPlayOrder(matrix: ProjectMatrix): void {
    playOrderIds = matrix.cells.filter((c) => c.enabled).map((c) => c.id);
  }

  function installCell(cellId: string): boolean {
    const matrix = getMatrix();
    const cell = matrix.cells.find((c) => c.id === cellId);
    if (!cell) return false;
    const pattern = cellToPattern(cell, matrix);
    engine.setPattern(pattern);
    onPatternInstalled?.(pattern, lastInstalledPattern);
    lastInstalledPattern = pattern;
    onCellChange(cellId);
    return true;
  }

  function advance(): void {
    if (playOrderIds.length === 0) {
      // All cells disabled — stop cleanly.
      stopInternal();
      return;
    }
    // Re-latch play order in case cells toggled during the last bar.
    // Reorders take effect on this recalc (next bar), not mid-bar.
    latchPlayOrder(getMatrix());
    if (playOrderIds.length === 0) {
      stopInternal();
      return;
    }
    activeIndex = (activeIndex + 1) % playOrderIds.length;
    const nextId = playOrderIds[activeIndex]!;
    installCell(nextId);
  }

  function stopInternal(): void {
    if (!isRunning) return;
    isRunning = false;
    engine.stop();
    activeIndex = -1;
    lastStep = -1;
    onCellChange(null);
    stepUnsub?.();
    stepUnsub = null;
  }

  return {
    start: () => {
      if (isRunning) return;
      latchPlayOrder(getMatrix());
      if (playOrderIds.length === 0) {
        // Nothing to play; do not start transport.
        return;
      }
      activeIndex = 0;
      installCell(playOrderIds[0]!);
      void engine.play();
      isRunning = true;
      lastStep = -1;
      stepUnsub = engine.subscribe("step", (step) => {
        if (typeof step !== "number") return;
        // Advance after the last step of a cycle fires and before step 0
        // of the next cycle runs. The snapshot swap happens inside this
        // callback, so the next step 0 reads the new cell's tracks.
        // Using `step === 7` (not an edge on wrap) avoids a race where
        // re-enabling a listener mid-play starts with lastStep === -1 and
        // would otherwise never fire until a full extra cycle elapsed.
        if (step === 7 && lastStep !== 7) {
          advance();
        }
        lastStep = step;
      });
    },
    stop: () => stopInternal(),
    setMatrix: (matrix) => {
      // When a new matrix lands mid-play, keep playing if possible — just
      // re-latch play order and land on a valid cell. If the currently
      // active cell got disabled or removed, jump to whichever enabled
      // cell comes next in the new order.
      latchPlayOrder(matrix);
      if (!isRunning) return;
      const currentId = playOrderIds[activeIndex];
      const idx = currentId ? playOrderIds.indexOf(currentId) : -1;
      if (idx >= 0) {
        activeIndex = idx;
      } else if (playOrderIds.length > 0) {
        activeIndex = 0;
        installCell(playOrderIds[0]!);
      } else {
        stopInternal();
      }
    },
    dispose: () => {
      stopInternal();
    },
  };
}

/**
 * Default cellToPattern: reconstructs a flat v1 Pattern view from a cell
 * plus the matrix's shared bpm/masterGain, which is what the engine's
 * legacy setPattern() accepts.
 */
export function defaultCellToPattern(
  cell: MixerCell,
  matrix: ProjectMatrix,
): Pattern {
  return {
    schemaVersion: 1,
    bpm: matrix.sharedBpm,
    masterGain: matrix.masterGain,
    stepCount: cell.pattern.stepCount,
    tracks: cell.pattern.tracks,
    effects: cell.effects,
  };
}
