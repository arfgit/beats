import { describe, it, expect } from "vitest";
import { createDefaultPattern } from "@beats/shared";
import { freezeSnapshot } from "./snapshot";

describe("freezeSnapshot", () => {
  it("mirrors pattern shape field-for-field", () => {
    const pattern = createDefaultPattern();
    const snap = freezeSnapshot(pattern);
    expect(snap.bpm).toBe(pattern.bpm);
    expect(snap.masterGain).toBe(pattern.masterGain);
    expect(snap.stepCount).toBe(pattern.stepCount);
    expect(snap.tracks).toHaveLength(pattern.tracks.length);
    expect(snap.effects).toHaveLength(pattern.effects.length);
  });

  it("computes anySoloed correctly", () => {
    const pattern = createDefaultPattern();
    expect(freezeSnapshot(pattern).anySoloed).toBe(false);
    pattern.tracks[0]!.soloed = true;
    expect(freezeSnapshot(pattern).anySoloed).toBe(true);
  });

  it("derives sampleKey from sampleId + version", () => {
    const pattern = createDefaultPattern();
    pattern.tracks[0]!.sampleId = "kick-01";
    pattern.tracks[0]!.sampleVersion = 3;
    const snap = freezeSnapshot(pattern);
    expect(snap.tracks[0]?.sampleKey).toBe("kick-01:3");
  });

  it("leaves sampleKey null when id or version missing", () => {
    const pattern = createDefaultPattern();
    pattern.tracks[0]!.sampleId = "kick-01";
    pattern.tracks[0]!.sampleVersion = null;
    const snap = freezeSnapshot(pattern);
    expect(snap.tracks[0]?.sampleKey).toBeNull();
  });

  it("produces independent step arrays (mutation isolation)", () => {
    const pattern = createDefaultPattern();
    const snap = freezeSnapshot(pattern);
    pattern.tracks[0]!.steps[0]!.active = true;
    expect(snap.tracks[0]?.steps[0]?.active).toBe(false);
  });

  it("deep-clones effect params so downstream mutation is safe", () => {
    const pattern = createDefaultPattern();
    const snap = freezeSnapshot(pattern);
    pattern.effects[0]!.params.wet = 1;
    expect(snap.effects[0]?.params.wet).not.toBe(1);
  });
});
