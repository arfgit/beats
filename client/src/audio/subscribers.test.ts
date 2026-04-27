import { describe, it, expect, vi } from "vitest";
import { EngineSubscribers } from "./subscribers";

describe("EngineSubscribers", () => {
  it("delivers step events to subscribers", () => {
    const subs = new EngineSubscribers();
    const cb = vi.fn();
    subs.subscribe("step", cb);
    subs.emit("step", 3);
    expect(cb).toHaveBeenCalledWith(3);
  });

  it("delivers rec events to subscribers", () => {
    const subs = new EngineSubscribers();
    const cb = vi.fn();
    subs.subscribe("rec", cb);
    subs.emit("rec", { active: true, elapsedMs: 500 });
    expect(cb).toHaveBeenCalledWith({ active: true, elapsedMs: 500 });
  });

  it("unsubscribes via the returned disposer", () => {
    const subs = new EngineSubscribers();
    const cb = vi.fn();
    const dispose = subs.subscribe("step", cb);
    dispose();
    subs.emit("step", 5);
    expect(cb).not.toHaveBeenCalled();
  });

  it("isolates listeners — one throwing does not break others", () => {
    const subs = new EngineSubscribers();
    const good = vi.fn();
     
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    subs.subscribe("step", () => {
      throw new Error("boom");
    });
    subs.subscribe("step", good);
    subs.emit("step", 0);
    expect(good).toHaveBeenCalledWith(0);
    consoleErr.mockRestore();
  });

  it("does not cross-talk between event buckets", () => {
    const subs = new EngineSubscribers();
    const stepCb = vi.fn();
    const recCb = vi.fn();
    subs.subscribe("step", stepCb);
    subs.subscribe("rec", recCb);
    subs.emit("step", 1);
    expect(stepCb).toHaveBeenCalledTimes(1);
    expect(recCb).not.toHaveBeenCalled();
  });

  it("clear() drops all listeners", () => {
    const subs = new EngineSubscribers();
    const cb = vi.fn();
    subs.subscribe("step", cb);
    subs.clear();
    subs.emit("step", 0);
    expect(cb).not.toHaveBeenCalled();
  });
});
