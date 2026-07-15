// Per-key serialized latest-wins retry queue — the ordering/retry guarantees
// reservation writes were missing on the fallback path (15.07 audit): an
// older visit-state PATCH landing after a newer one resurrected a cleared
// table, and a failed write was logged and lost.

import { describe, it, expect, vi } from "vitest";
import { createWriteQueue } from "../lib/writeQueue.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("createWriteQueue", () => {
  it("serializes writes per key — the older value can never land after the newer", async () => {
    const landed = [];
    let releaseFirst;
    const gate = new Promise((r) => { releaseFirst = r; });
    let call = 0;
    const q = createWriteQueue(async (_k, v) => {
      call += 1;
      if (call === 1) await gate; // the first request stalls on the network
      landed.push(v.state);
    });
    const p1 = q.save("res-1", { state: "terrace" });
    const p2 = q.save("res-1", { state: "cleared" });
    releaseFirst();
    await Promise.all([p1, p2]);
    // latest-wins: the stalled first attempt already carried the NEWEST value
    // (or the second attempt re-sent it) — 'terrace' can never overwrite it.
    expect(landed[landed.length - 1]).toBe("cleared");
    expect(landed).not.toContain(undefined);
  });

  it("keys are independent — one reservation's write never blocks another's", async () => {
    const landed = [];
    const q = createWriteQueue(async (k, v) => { landed.push([k, v]); });
    await Promise.all([q.save("res-1", 1), q.save("res-2", 2)]);
    expect(landed.map(([k]) => k).sort()).toEqual(["res-1", "res-2"]);
  });

  it("a failure retains the value (pending) and reports {ok:false} honestly", async () => {
    const q = createWriteQueue(async () => { throw new Error("network down"); });
    const r = await q.save("res-1", { state: "cleared" });
    expect(r.ok).toBe(false);
    expect(q.pending()).toEqual(["res-1"]);
  });

  it("flushAll pushes a retained value out once connectivity returns", async () => {
    let fail = true;
    const landed = [];
    const q = createWriteQueue(async (_k, v) => {
      if (fail) throw new Error("offline");
      landed.push(v);
    });
    await q.save("res-1", { state: "cleared" });
    fail = false;
    q.flushAll();
    await tick(10);
    expect(landed).toEqual([{ state: "cleared" }]);
    expect(q.pending()).toEqual([]);
  });

  it("drop() discards a retained value — nothing replays after it", async () => {
    let fail = true;
    const write = vi.fn(async () => { if (fail) throw new Error("offline"); });
    const q = createWriteQueue(write);
    await q.save("res-1", { state: "stale" });
    q.drop("res-1");
    fail = false;
    q.flushAll();
    await tick(10);
    expect(write).toHaveBeenCalledTimes(1); // only the original failed attempt
    expect(q.pending()).toEqual([]);
  });

  it("a newer save supersedes the retained older value", async () => {
    let fail = true;
    const landed = [];
    const q = createWriteQueue(async (_k, v) => {
      if (fail) throw new Error("offline");
      landed.push(v.state);
    });
    await q.save("res-1", { state: "old" });
    fail = false;
    await q.save("res-1", { state: "new" });
    expect(landed).toEqual(["new"]);
    expect(q.pending()).toEqual([]);
  });
});
