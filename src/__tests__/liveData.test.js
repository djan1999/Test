import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLiveQuery, invalidateLiveData, getLiveStatus } from "../lib/liveData.js";

const disposers = [];
const register = options => {
  const query = registerLiveQuery({ key: "menu", scope: "a", tables: ["menu_courses"], ...options });
  disposers.push(query.dispose); return query;
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
afterEach(() => { disposers.splice(0).forEach(fn => fn()); vi.useRealTimers(); });

describe("shared data recovery", () => {
  it("discards a read superseded by another device's notification", async () => {
    const stale = deferred(); const apply = vi.fn();
    const read = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(["new menu"]);
    register({ read, apply }); await vi.advanceTimersByTimeAsync(0);
    const catchup = invalidateLiveData("menu_courses", "a");
    stale.resolve(["old menu"]); await catchup;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(["new menu"]);
  });
  it("still paints while notifications keep outpacing reads", async () => {
    // Service: another device taps faster than one read completes. The board
    // must not wait for a quiet gap before anything lands.
    let n = 0; const apply = vi.fn();
    register({ read: async () => { if (++n < 20) invalidateLiveData("menu_courses", "a"); return n; }, apply });
    await vi.advanceTimersByTimeAsync(0);
    // Before: nothing painted until read 20, when the taps stopped.
    expect(apply.mock.calls[0][0]).toBe(2);
    expect(apply).toHaveBeenLastCalledWith(20);
  });
  it("never delays a background reader's first load", async () => {
    const read = vi.fn(async () => ["menu"]), apply = vi.fn();
    register({ read, apply, lane: "background", immediate: false });
    invalidateLiveData("menu_courses", "a", { passive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith(["menu"]);
  });
  it("an explicit reload of a background reader is immediate", async () => {
    const read = vi.fn(async () => []); register({ read, apply: vi.fn(), lane: "background" });
    await vi.advanceTimersByTimeAsync(0);
    await invalidateLiveData("menu_courses", "a");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("retains the last good snapshot on failure and retries without a reset", async () => {
    const apply = vi.fn(); const read = vi.fn().mockResolvedValueOnce(["cached"])
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(["caught up"]);
    const query = register({ read, apply }); await vi.advanceTimersByTimeAsync(0);
    await query.refresh(); expect(getLiveStatus()[0].state).toBe("error");
    expect(apply).toHaveBeenLastCalledWith(["cached"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply).toHaveBeenLastCalledWith(["caught up"]);
    expect(getLiveStatus()[0].state).toBe("ready");
  });
  it("catches missed updates and deletions on wake, reconnect, and periodic refresh", async () => {
    let rows = ["old"]; const apply = vi.fn(); register({ read: async () => rows, apply });
    await vi.advanceTimersByTimeAsync(0); rows = [];
    window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(250);
    expect(apply).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenLastCalledWith([]);
    rows = ["new"]; await vi.advanceTimersByTimeAsync(60000);
    expect(apply).toHaveBeenLastCalledWith(["new"]);
  });
  it("does not poll hidden screens; refreshes when visible again", async () => {
    const read = vi.fn(async () => []); register({ read, apply: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("cannot adopt a completed read after workspace disposal", async () => {
    const request = deferred(); const apply = vi.fn();
    const query = register({ read: () => request.promise, apply });
    await vi.advanceTimersByTimeAsync(0); query.dispose(); request.resolve(["other restaurant"]);
    await vi.advanceTimersByTimeAsync(0); expect(apply).not.toHaveBeenCalled();
    expect(getLiveStatus()).toEqual([]);
  });
  it("limits invalidations to the intended workspace and dataset", async () => {
    const a = vi.fn(async () => []), b = vi.fn(async () => []);
    register({ read: a, apply: vi.fn() }); register({ scope: "b", read: b, apply: vi.fn() });
    await vi.advanceTimersByTimeAsync(0); await invalidateLiveData("menu_courses", "a");
    expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(1);
  });
  it("marks protected drafts as held instead of claiming they adopted remote data", async () => {
    register({ read: async () => [], apply: () => false }); await vi.advanceTimersByTimeAsync(0);
    expect(getLiveStatus()[0].state).toBe("held");
  });
  it("times out a stuck read and recovers while ignoring its late result", async () => {
    const request = deferred(), apply = vi.fn();
    const read = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(["fresh"]);
    register({ read, apply, timeoutMs: 500 }); await vi.advanceTimersByTimeAsync(1500);
    expect(apply).toHaveBeenLastCalledWith(["fresh"]);
    request.resolve(["late"]); await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
