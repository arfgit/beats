import { describe, it, expect, beforeEach, vi } from "vitest";
import { MATRIX_CELL_COUNT } from "@beats/shared";

vi.mock("@/audio/engine", () => ({
  audioEngine: {
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(new Blob()),
    isStarted: vi.fn().mockReturnValue(false),
    previewTrack: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    reset: vi.fn(),
  },
}));

const { useBeatsStore } = await import("./useBeatsStore");

describe("matrixSlice", () => {
  beforeEach(() => {
    useBeatsStore.getState().resetMatrix();
    useBeatsStore.getState().resetPattern();
  });

  it("initializes with 9 cells, first cell enabled", () => {
    const { matrix } = useBeatsStore.getState();
    expect(matrix.cells).toHaveLength(MATRIX_CELL_COUNT);
    expect(matrix.cells[0]?.enabled).toBe(true);
    expect(matrix.cells[1]?.enabled).toBe(false);
  });

  it("toggleCellEnabled flips a single cell", () => {
    const { toggleCellEnabled } = useBeatsStore.getState();
    const cellId = useBeatsStore.getState().matrix.cells[3]!.id;
    toggleCellEnabled(cellId);
    expect(
      useBeatsStore.getState().matrix.cells.find((c) => c.id === cellId)
        ?.enabled,
    ).toBe(true);
    toggleCellEnabled(cellId);
    expect(
      useBeatsStore.getState().matrix.cells.find((c) => c.id === cellId)
        ?.enabled,
    ).toBe(false);
  });

  it("reorderCells moves a cell without changing count", () => {
    const { reorderCells } = useBeatsStore.getState();
    const before = useBeatsStore.getState().matrix.cells.map((c) => c.id);
    reorderCells(0, 4);
    const after = useBeatsStore.getState().matrix.cells.map((c) => c.id);
    expect(after).toHaveLength(before.length);
    expect(after[4]).toBe(before[0]);
    // First cell now used to be at index 1
    expect(after[0]).toBe(before[1]);
  });

  it("syncPatternIntoMatrix writes current pattern into selected cell", () => {
    const { setBpm, setMasterGain, syncPatternIntoMatrix } =
      useBeatsStore.getState();
    setBpm(143);
    setMasterGain(0.42);
    syncPatternIntoMatrix();
    const { matrix, selectedCellId } = useBeatsStore.getState();
    expect(matrix.sharedBpm).toBe(143);
    expect(matrix.masterGain).toBeCloseTo(0.42);
    const cell = matrix.cells.find((c) => c.id === selectedCellId);
    expect(cell).toBeTruthy();
  });

  it("setSelectedCellId flushes previous edits before swapping", () => {
    const state = useBeatsStore.getState();
    const firstId = state.matrix.cells[0]!.id;
    const secondId = state.matrix.cells[1]!.id;
    state.setSelectedCellId(firstId);
    // Edit current pattern (cell 0 scope)
    state.setBpm(101);
    // Switch to cell 1 — should flush the 101 bpm into matrix first
    state.setSelectedCellId(secondId);
    const { matrix } = useBeatsStore.getState();
    expect(matrix.sharedBpm).toBe(101);
    expect(useBeatsStore.getState().selectedCellId).toBe(secondId);
  });

  it("setTrackKind changes kind and clears sample on that track", () => {
    const { matrix: m0 } = useBeatsStore.getState();
    const cellId = m0.cells[0]!.id;
    const trackId = m0.cells[0]!.pattern.tracks[0]!.id;
    useBeatsStore.getState().setTrackKind(cellId, trackId, "vocals");
    const { matrix } = useBeatsStore.getState();
    const track = matrix.cells
      .find((c) => c.id === cellId)
      ?.pattern.tracks.find((t) => t.id === trackId);
    expect(track?.kind).toBe("vocals");
    expect(track?.sampleId).toBeNull();
  });

  it("cell switch clears undo history — no cross-cell replays", () => {
    const state = useBeatsStore.getState();
    const firstId = state.matrix.cells[0]!.id;
    const secondId = state.matrix.cells[1]!.id;
    state.setSelectedCellId(firstId);

    // Make an edit so there's something to potentially undo.
    state.clearHistory();
    const trackId = state.pattern.tracks[0]!.id;
    state.toggleStep(trackId, 0);
    expect(useBeatsStore.getState().history.past.length).toBe(1);

    // Switching cells should wipe history so an undo on cell 2 can't
    // accidentally replay patches from cell 1.
    state.setSelectedCellId(secondId);
    expect(useBeatsStore.getState().history.past.length).toBe(0);
  });

  it("reorderTracks on selected cell updates pattern after loadCell", () => {
    const state = useBeatsStore.getState();
    const cellId = state.selectedCellId;
    const originalOrder = state.matrix.cells
      .find((c) => c.id === cellId)!
      .pattern.tracks.map((t) => t.id);
    // Reorder within the cell and then reload pattern view.
    state.reorderTracks(cellId, 0, 2);
    state.loadCellIntoPattern(cellId);
    const afterOrder = useBeatsStore.getState().pattern.tracks.map((t) => t.id);
    expect(afterOrder[2]).toBe(originalOrder[0]);
    expect(afterOrder.length).toBe(originalOrder.length);
  });
});
