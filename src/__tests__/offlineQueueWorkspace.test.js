import { describe, it, expect, beforeEach, vi } from "vitest";

// Control the "current workspace" the same way the real app does (a module
// singleton in supabaseClient). We only need getWorkspaceId for scopeJob.
const h = vi.hoisted(() => ({ ws: "ws-A" }));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: { from: () => ({}) },
  getWorkspaceId: () => h.ws,
}));

import { scopeJob } from "../lib/scopedDb.js";

beforeEach(() => { h.ws = "ws-A"; });

describe("scopeJob (offline-queue workspace stamping)", () => {
  it("stamps workspace_id into an upsert payload and fixes the composite onConflict", () => {
    const job = scopeJob({ table: "service_tables", op: "upsert", payload: [{ table_id: 1, data: {} }], options: { onConflict: "table_id" } });
    expect(job.payload).toEqual([{ table_id: 1, data: {}, workspace_id: "ws-A" }]);
    expect(job.options).toEqual({ onConflict: "workspace_id,table_id" });
    expect(job.workspaceId).toBe("ws-A");
  });

  it("stamps an insert payload (single row)", () => {
    const job = scopeJob({ table: "reservations", op: "insert", payload: { date: "2026-06-07", data: {} } });
    expect(job.payload).toEqual({ date: "2026-06-07", data: {}, workspace_id: "ws-A" });
  });

  it("adds workspace_id to update payload AND match", () => {
    const job = scopeJob({ table: "reservations", op: "update", payload: { data: { x: 1 } }, match: { id: "r1" } });
    expect(job.payload).toEqual({ data: { x: 1 }, workspace_id: "ws-A" });
    expect(job.match).toEqual({ id: "r1", workspace_id: "ws-A" });
  });

  it("adds workspace_id to a delete match", () => {
    const job = scopeJob({ table: "reservations", op: "delete", match: { id: "r1" } });
    expect(job.match).toEqual({ id: "r1", workspace_id: "ws-A" });
  });

  it("captures the workspace at ENQUEUE time, not flush time", () => {
    // A job created while in workspace A must keep A even if the user later
    // switches to workspace B before the queue flushes.
    const job = scopeJob({ table: "reservations", op: "delete", match: { id: "r1" } });
    h.ws = "ws-B"; // user switched profiles
    // The already-stamped job still targets A.
    expect(job.match.workspace_id).toBe("ws-A");
  });

  it("leaves the job untouched when there is no workspace (local-only mode)", () => {
    h.ws = null;
    const original = { table: "reservations", op: "delete", match: { id: "r1" } };
    expect(scopeJob(original)).toBe(original);
  });
});
