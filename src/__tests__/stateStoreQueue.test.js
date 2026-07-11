// saveStateKey durability — pins the 11.07 hardening. The fallback settings
// upsert used to fire once and discard the value on failure ({ok:false} that
// nearly every caller ignored): a wifi blip silently ate floor SET markers,
// kitchen ticket order, the service date. Now each key has a serialized,
// latest-value-wins queue with capped-backoff retries, an online flush, and
// a write-path re-check so a retry that fires after the device flips to
// sqlite-primary rides the durable PowerSync queue instead.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const upsertMock = vi.fn();
const writeSettingMock = vi.fn();
let sqlitePrimary = false;

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {},
  getWorkspaceId: () => "ws-test",
  TABLES: { SERVICE_SETTINGS: "service_settings" },
}));
vi.mock("../lib/scopedDb.js", () => ({
  scopedFrom: () => ({ upsert: upsertMock, select: vi.fn() }),
}));
vi.mock("../powersync/primary.js", () => ({
  isSqlitePrimary: () => sqlitePrimary,
}));
vi.mock("../powersync/writes.js", () => ({
  writeSetting: writeSettingMock,
}));

const { saveStateKey, pendingStateKeys } = await import("../lib/stateStore.js");

describe("saveStateKey — durable fallback queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sqlitePrimary = false;
    upsertMock.mockReset().mockResolvedValue({ error: null });
    writeSettingMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("a failed write returns ok:false but RETAINS the value and retries until it lands", async () => {
    upsertMock
      .mockResolvedValueOnce({ error: new Error("network blip") })
      .mockResolvedValue({ error: null });

    const result = await saveStateKey("k_retry", { v: 1 });
    expect(result.ok).toBe(false); // caller still sees an honest result
    expect(pendingStateKeys()).toContain("k_retry");

    await vi.advanceTimersByTimeAsync(2100); // first backoff tick
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(pendingStateKeys()).not.toContain("k_retry");
    expect(upsertMock.mock.calls[1][0].state).toEqual({ v: 1 });
  });

  it("latest value wins — a retry never resurrects an older value", async () => {
    upsertMock
      .mockResolvedValueOnce({ error: new Error("down") })
      .mockResolvedValue({ error: null });

    await saveStateKey("k_latest", { v: "old" });
    await saveStateKey("k_latest", { v: "new" }); // supersedes the failed old value

    await vi.advanceTimersByTimeAsync(60000);
    const written = upsertMock.mock.calls.map(c => c[0].state.v);
    expect(written[written.length - 1]).toBe("new");
    // the superseded old value must never be written AFTER the new one
    expect(written.lastIndexOf("old")).toBeLessThan(written.lastIndexOf("new"));
    expect(pendingStateKeys()).not.toContain("k_latest");
  });

  it("writes to the same key are serialized — no out-of-order upserts", async () => {
    const order = [];
    let release;
    upsertMock.mockImplementationOnce(async (row) => {
      order.push(`start:${row.state.v}`);
      await new Promise(r => { release = r; });
      order.push(`end:${row.state.v}`);
      return { error: null };
    }).mockImplementation(async (row) => {
      order.push(`start:${row.state.v}`);
      order.push(`end:${row.state.v}`);
      return { error: null };
    });

    const p1 = saveStateKey("k_order", { v: 1 });
    // let the first write actually start (hangs on the gate)…
    for (let i = 0; i < 100 && !order.includes("start:1"); i++) await Promise.resolve();
    expect(order).toEqual(["start:1"]);
    // …then a second save arrives while it is in flight.
    const p2 = saveStateKey("k_order", { v: 2 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(order).toEqual(["start:1"]); // second must NOT start concurrently
    release();
    await p1; await p2;
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("two saves in the same tick coalesce — only the latest is written", async () => {
    await saveStateKey("k_coalesce_seed", { v: 0 }); // isolate mock counts
    upsertMock.mockClear();
    const p1 = saveStateKey("k_coalesce", { v: "a" });
    const p2 = saveStateKey("k_coalesce", { v: "b" });
    await p1; await p2;
    const written = upsertMock.mock.calls.map(c => c[0].state.v);
    expect(written[written.length - 1]).toBe("b");
    expect(written).not.toContain("a"); // superseded before any write started
  });

  it("the 'online' signal flushes retained values immediately", async () => {
    upsertMock
      .mockResolvedValueOnce({ error: new Error("offline") })
      .mockResolvedValue({ error: null });

    await saveStateKey("k_online", { v: 7 });
    expect(pendingStateKeys()).toContain("k_online");

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(10);
    expect(pendingStateKeys()).not.toContain("k_online");
  });

  it("a retry that fires after sqlite becomes primary rides the PowerSync path", async () => {
    upsertMock.mockResolvedValueOnce({ error: new Error("fallback down") });

    await saveStateKey("k_handover", { v: 9 });
    expect(pendingStateKeys()).toContain("k_handover");

    sqlitePrimary = true; // device finished first sync mid-retry-window
    await vi.advanceTimersByTimeAsync(2100);
    expect(writeSettingMock).toHaveBeenCalledWith("k_handover", { v: 9 });
    expect(pendingStateKeys()).not.toContain("k_handover");
  });
});
