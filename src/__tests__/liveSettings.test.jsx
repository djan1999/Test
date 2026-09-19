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
import { invalidateLiveData } from "../lib/liveData.js";

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
});
