// The settings write queue retains a failed value and replays it on retry /
// the 'online' signal. dropPendingStateKey exists for values that became lies
// while they waited — the concrete case: a floor-strip blob retained on a
// flaky link, service then ENDS on another device; the replay would overwrite
// the ending device's {} wipe with the dead service's SET markers (15.07
// audit). Lifecycle adoption drops the pending key the moment it observes an
// end/replace.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(async () => { throw new Error("fake network: write failed"); }),
  ws: "ws-1",
  scopes: [],
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {},
  getWorkspaceId: () => h.ws,
  TABLES: { SERVICE_SETTINGS: "service_settings" },
}));
vi.mock("../lib/scopedDb.js", () => ({
  scopedFrom: (_table, workspaceId) => {
    h.scopes.push(workspaceId);
    return { upsert: h.upsert };
  },
}));
vi.mock("../powersync/primary.js", () => ({ isSqlitePrimary: () => false }));
vi.mock("../lib/sandbox.js", () => ({ isSandbox: () => false }));

import { saveStateKey, pendingStateKeys, dropPendingStateKey } from "../lib/stateStore.js";

describe("dropPendingStateKey (a retained settings value can be declared stale)", () => {
  beforeEach(() => {
    h.upsert.mockClear();
    h.ws = "ws-1";
    h.scopes = [];
  });

  it("a failed save is retained; dropping it stops the 'online' replay", async () => {
    const r = await saveStateKey("floor_status_v1", { dining_a: { T4: "SET" } });
    expect(r.ok).toBe(false);
    expect(pendingStateKeys()).toContain("floor_status_v1");

    dropPendingStateKey("floor_status_v1");
    expect(pendingStateKeys()).not.toContain("floor_status_v1");

    // connectivity returns — the dead service's strips must NOT replay
    const calls = h.upsert.mock.calls.length;
    window.dispatchEvent(new Event("online"));
    await new Promise((res) => setTimeout(res, 20));
    expect(h.upsert.mock.calls.length).toBe(calls);
  });

  it("dropping an unknown key is a safe no-op", () => {
    expect(() => dropPendingStateKey("never_written")).not.toThrow();
  });

  it("a retained retry can never jump into the workspace selected later", async () => {
    const key = "workspace_retry_contract";
    const first = await saveStateKey(key, { from: "A" });
    expect(first.ok).toBe(false);
    expect(h.scopes).toEqual(["ws-1"]);

    h.ws = "ws-2";
    expect(pendingStateKeys()).not.toContain(key);
    expect(pendingStateKeys("ws-1")).toContain(key);
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(h.scopes.length).toBeGreaterThan(1);
    expect(h.scopes.every((workspaceId) => workspaceId === "ws-1")).toBe(true);
    dropPendingStateKey(key, "ws-1");
  });
});
