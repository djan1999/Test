import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";

const h = vi.hoisted(() => ({ ws: "restaurant-a", pending: [], state: { items: ["aperitif"] }, fail: false }));
vi.mock("../lib/supabaseClient.js", () => ({ supabase: {}, getWorkspaceId: () => h.ws }));
vi.mock("../lib/stateStore.js", () => ({
  readStateKey: async () => { if (h.fail) throw new Error("offline"); return h.state; },
  pendingStateKeys: () => h.pending,
}));
vi.mock("../lib/sandbox.js", () => ({ isSandbox: () => false }));
import { useLiveSetting } from "../hooks/useLiveQuery.js";
import { invalidateLiveData, BACKGROUND_DELAY_MS } from "../lib/liveData.js";

function useItems() {
  const [items, setItems] = useState(["cached"]);
  useLiveSetting("quick_access", state => setItems(state?.items ?? []));
  return items;
}
beforeEach(() => { vi.useFakeTimers(); h.ws = "restaurant-a"; h.pending = []; h.fail = false; h.state = { items: ["aperitif"] }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("shared settings consumers", () => {
  it("updates two mounted surfaces and accepts an empty list and deleted setting", async () => {
    const first = renderHook(useItems), second = renderHook(useItems);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(first.result.current).toEqual(["aperitif"]);
    h.state = { items: ["digestif"] }; await act(() => invalidateLiveData("service_settings"));
    expect(first.result.current).toEqual(["digestif"]); expect(second.result.current).toEqual(["digestif"]);
    h.state = { items: [] }; await act(() => invalidateLiveData("service_settings"));
    expect(first.result.current).toEqual([]);
    h.state = null; await act(() => invalidateLiveData("service_settings")); expect(second.result.current).toEqual([]);
  });
  it("holds old server echoes while a local save is queued, then catches up", async () => {
    const { result } = renderHook(useItems); await act(() => vi.advanceTimersByTimeAsync(0));
    h.pending = ["quick_access"]; h.state = { items: ["stale echo"] };
    await act(() => invalidateLiveData("service_settings")); expect(result.current).toEqual(["aperitif"]);
    h.pending = []; h.state = { items: ["saved edit"] };
    await act(() => invalidateLiveData("service_settings")); expect(result.current).toEqual(["saved edit"]);
  });
  it("keeps cached data during an outage and catches a missed edit on focus", async () => {
    const { result } = renderHook(useItems); await act(() => vi.advanceTimersByTimeAsync(0));
    h.fail = true; await act(() => invalidateLiveData("service_settings"));
    expect(result.current).toEqual(["aperitif"]);
    h.fail = false; h.state = { items: ["remote menu"] };
    window.dispatchEvent(new Event("focus")); await act(() => vi.advanceTimersByTimeAsync(250));
    expect(result.current).toEqual(["remote menu"]);
  });

  it("paints a live-service setting at once; config waits and coalesces", async () => {
    const reads = { live: 0, config: 0 };
    const useLane = (lane) => {
      const [items, setItems] = useState(null);
      useLiveSetting(lane === "live" ? "floor_status_v2:1" : "quick_access", state => {
        reads[lane] += 1; setItems(state?.items);
      }, { lane: lane === "live" ? "live" : "background" });
      return items;
    };
    const live = renderHook(() => useLane("live")), config = renderHook(() => useLane("config"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    h.state = { items: ["table 4 SET"] };
    // A burst of taps from another device during service.
    await act(async () => { for (let i = 0; i < 5; i += 1) await invalidateLiveData("service_settings", null, { passive: true }); });
    expect(live.result.current).toEqual(["table 4 SET"]);
    expect(config.result.current).toEqual(["aperitif"]);
    await act(() => vi.advanceTimersByTimeAsync(BACKGROUND_DELAY_MS));
    expect(config.result.current).toEqual(["table 4 SET"]);
    expect(reads.config).toBe(2); // initial + one coalesced catch-up
  });
  it("does not re-adopt (re-render) a setting that did not change", async () => {
    const apply = vi.fn();
    renderHook(() => useLiveSetting("quick_access", apply));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => invalidateLiveData("service_settings"));
    await act(() => invalidateLiveData("service_settings"));
    expect(apply).toHaveBeenCalledTimes(1);
    h.state = { items: ["changed"] }; await act(() => invalidateLiveData("service_settings"));
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it("re-adopts after a held read once the pending save clears", async () => {
    const apply = vi.fn();
    h.pending = ["quick_access"];
    renderHook(() => useLiveSetting("quick_access", apply));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(apply).not.toHaveBeenCalled();
    h.pending = []; await act(() => invalidateLiveData("service_settings"));
    expect(apply).toHaveBeenCalledWith({ items: ["aperitif"] });
  });
});
