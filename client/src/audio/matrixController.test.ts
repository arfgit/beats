import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDefaultMatrix, type ProjectMatrix } from "@beats/shared";
import {
  createMatrixController,
  defaultCellToPattern,
} from "./matrixController";
import type { AudioEngine } from "./engine";

// Stub engine that captures setPattern calls + exposes a manual step
// emitter so we can simulate bar boundaries deterministically.
function makeStubEngine() {
  const stepSubscribers = new Set<(step: number) => void>();
  const engine = {
    setPattern: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    subscribe: vi.fn((event: string, cb: (v: unknown) => void) => {
      if (event !== "step") return () => undefined;
      stepSubscribers.add(cb as (step: number) => void);
      return () => stepSubscribers.delete(cb as (step: number) => void);
    }),
  };
  const emitStep = (step: number) => {
    stepSubscribers.forEach((cb) => cb(step));
  };
  return { engine: engine as unknown as AudioEngine, emitStep };
}

function enableCells(matrix: ProjectMatrix, indices: number[]): ProjectMatrix {
  return {
    ...matrix,
    cells: matrix.cells.map((c, i) => ({ ...c, enabled: indices.includes(i) })),
  };
}

function emitFullCycle(emitStep: (n: number) => void): void {
  for (let i = 0; i < 8; i++) emitStep(i);
}

describe("matrixController", () => {
  let matrix: ProjectMatrix;
  let onCellChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matrix = enableCells(createDefaultMatrix(), [0, 2, 4]);
    onCellChange = vi.fn();
  });

  it("starts with the first enabled cell", () => {
    const { engine } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start();
    expect(onCellChange).toHaveBeenLastCalledWith(matrix.cells[0]!.id);
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("advances through enabled cells on bar wrap", () => {
    const { engine, emitStep } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start(); // cell 0

    emitFullCycle(emitStep); // wraps → advance to cell 2 (next enabled)
    expect(onCellChange).toHaveBeenLastCalledWith(matrix.cells[2]!.id);

    emitFullCycle(emitStep); // advance to cell 4
    expect(onCellChange).toHaveBeenLastCalledWith(matrix.cells[4]!.id);

    emitFullCycle(emitStep); // wraps back to cell 0
    expect(onCellChange).toHaveBeenLastCalledWith(matrix.cells[0]!.id);
  });

  it("skips disabled cells entirely", () => {
    const { engine, emitStep } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start();
    emitFullCycle(emitStep);
    // Should NOT have landed on cells 1 or 3 (disabled).
    const calls = onCellChange.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(matrix.cells[1]!.id);
    expect(calls).not.toContain(matrix.cells[3]!.id);
  });

  it("stops when all cells become disabled", () => {
    const { engine, emitStep } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start();
    // Disable every cell before the next bar boundary.
    matrix = enableCells(matrix, []);
    emitFullCycle(emitStep);
    expect(engine.stop).toHaveBeenCalled();
    expect(onCellChange).toHaveBeenLastCalledWith(null);
  });

  it("does not start when no cells are enabled", () => {
    matrix = enableCells(matrix, []);
    const { engine } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start();
    expect(engine.play).not.toHaveBeenCalled();
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it("re-latches play order each bar (picks up toggles)", () => {
    const { engine, emitStep } = makeStubEngine();
    const ctrl = createMatrixController({
      engine,
      getMatrix: () => matrix,
      cellToPattern: defaultCellToPattern,
      onCellChange,
    });
    ctrl.start(); // cell 0

    // Enable cell 1 mid-play — should be picked up on the next bar wrap.
    matrix = enableCells(matrix, [0, 1, 2, 4]);
    emitFullCycle(emitStep);
    // The active index was 0 (cell 0). After advance, index becomes 1,
    // which in the NEW play order is cell 1 (freshly enabled).
    expect(onCellChange).toHaveBeenLastCalledWith(matrix.cells[1]!.id);
  });
});
