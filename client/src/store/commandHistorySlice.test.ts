import { describe, it, expect } from "vitest";
import { createDefaultPattern } from "@beats/shared";
import { useBeatsStore } from "./useBeatsStore";

describe("command history (undo/redo)", () => {
  it("records toggleStep and undoes it", () => {
    const { resetPattern, clearHistory, toggleStep, undo } =
      useBeatsStore.getState();
    resetPattern();
    clearHistory();
    const trackId = useBeatsStore.getState().pattern.tracks[0]!.id;
    toggleStep(trackId, 0);
    expect(useBeatsStore.getState().pattern.tracks[0]?.steps[0]?.active).toBe(
      true,
    );
    undo();
    expect(useBeatsStore.getState().pattern.tracks[0]?.steps[0]?.active).toBe(
      false,
    );
  });

  it("redo replays an undone toggle", () => {
    const { resetPattern, clearHistory, toggleStep, undo, redo } =
      useBeatsStore.getState();
    resetPattern();
    clearHistory();
    const trackId = useBeatsStore.getState().pattern.tracks[0]!.id;
    toggleStep(trackId, 2);
    undo();
    redo();
    expect(useBeatsStore.getState().pattern.tracks[0]?.steps[2]?.active).toBe(
      true,
    );
  });

  it("new action clears redo stack", () => {
    const { resetPattern, clearHistory, toggleStep, undo } =
      useBeatsStore.getState();
    resetPattern();
    clearHistory();
    const trackId = useBeatsStore.getState().pattern.tracks[0]!.id;
    toggleStep(trackId, 0);
    undo();
    expect(useBeatsStore.getState().history.future).toHaveLength(1);
    toggleStep(trackId, 1);
    expect(useBeatsStore.getState().history.future).toHaveLength(0);
  });

  it("continuous mutations (setBpm) do not pollute history", () => {
    const { resetPattern, clearHistory, setBpm } = useBeatsStore.getState();
    resetPattern();
    clearHistory();
    setBpm(130);
    setBpm(140);
    setBpm(150);
    expect(useBeatsStore.getState().history.past).toHaveLength(0);
    expect(useBeatsStore.getState().pattern.bpm).toBe(150);
  });

  it("caps history at 100 entries", () => {
    const { resetPattern, clearHistory, toggleStep } = useBeatsStore.getState();
    resetPattern();
    clearHistory();
    const trackId = useBeatsStore.getState().pattern.tracks[0]!.id;
    for (let i = 0; i < 120; i++) toggleStep(trackId, i % 8);
    expect(useBeatsStore.getState().history.past.length).toBeLessThanOrEqual(
      100,
    );
  });

  it("default pattern matches shared helper", () => {
    const { resetPattern } = useBeatsStore.getState();
    resetPattern();
    const pattern = useBeatsStore.getState().pattern;
    const expected = createDefaultPattern();
    expect(pattern.tracks).toHaveLength(expected.tracks.length);
    expect(pattern.effects).toHaveLength(expected.effects.length);
  });
});
