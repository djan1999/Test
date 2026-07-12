// The sandbox ("Test Service") kill-switch: every low-level persistence seam
// must become a hard no-op while it is ON, so a test service can never write
// to Supabase or the on-device DB. These unit pins guard the seams directly;
// appHarnessTestService.test.jsx proves the end-to-end flow through the App.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  scopedSpy: vi.fn(() => { throw new Error("scopedFrom must NOT be reached while sandbox is on"); }),
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {},
  getWorkspaceId: () => "ws-1",
  TABLES: { SERVICE_SETTINGS: "service_settings", SERVICE_ARCHIVE: "service_archive" },
}));
vi.mock("../lib/scopedDb.js", () => ({ scopedFrom: h.scopedSpy }));
vi.mock("../powersync/primary.js", () => ({ isSqlitePrimary: () => false }));

import { setSandbox } from "../lib/sandbox.js";
import { saveStateKey, pendingStateKeys } from "../lib/stateStore.js";
import { archiveSetDeleted, archiveSetAllDeleted, archivePurgeTrash } from "../lib/archiveStore.js";
import { finishServiceStore } from "../lib/serviceLifecycleStore.js";

beforeEach(() => { h.scopedSpy.mockClear(); });
afterEach(() => { setSandbox(false); });

describe("sandbox kill-switch", () => {
  it("saveStateKey writes nothing and never queues a retry while sandbox is on", async () => {
    setSandbox(true);
    const res = await saveStateKey("service_date", { date: "2026-07-12", startedAt: "S" });
    expect(res).toEqual({ ok: true });
    expect(h.scopedSpy).not.toHaveBeenCalled();
    // The value was never queued, so nothing is waiting to reach the store.
    expect(pendingStateKeys()).not.toContain("service_date");
  });

  it("archive edits (delete / delete-all / purge) no-op while sandbox is on", async () => {
    setSandbox(true);
    expect(await archiveSetDeleted("id", new Date().toISOString())).toEqual({ ok: true });
    expect(await archiveSetAllDeleted(new Date().toISOString())).toEqual({ ok: true });
    expect(await archivePurgeTrash()).toEqual({ ok: true });
    expect(h.scopedSpy).not.toHaveBeenCalled();
  });

  it("finishServiceStore files no archive and clears no rows while sandbox is on", async () => {
    setSandbox(true);
    const client = { rpc: vi.fn() };
    const res = await finishServiceStore({
      client, workspaceId: "ws-1", sqlitePrimary: false,
      archive: { id: "a1", date: "2026-07-12", label: "L", state: {} },
      expected: { startedAt: "S", date: "2026-07-12" },
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(res.superseded).toBe(false);
    expect(res.rows).toHaveLength(10); // blank board handed back for the local UI
  });

  it("with sandbox OFF the seams reach the store again (saveStateKey queues)", async () => {
    setSandbox(false);
    await saveStateKey("floor_status_v1", { dining_a: { T1: "SET" } });
    // The fallback path went through scopedFrom (our spy throws → swallowed by
    // the queue's retry), proving the guard is what suppressed it above.
    expect(h.scopedSpy).toHaveBeenCalled();
  });
});
