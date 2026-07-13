import { describe, expect, it, vi } from "vitest";
import { finishServiceStore, makeBlankServiceRows } from "../lib/serviceLifecycleStore.js";

describe("service lifecycle store", () => {
  it("builds all ten blank rows with one shared timestamp", () => {
    const rows = makeBlankServiceRows("end-time");
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.table_id)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(rows.every((row) => row.updated_at === "end-time" && Object.keys(row.data).length === 0)).toBe(true);
  });

  it("builds the configured table set instead of assuming ten", () => {
    const rows = makeBlankServiceRows("end-time", [12, 2, 12, 7]);
    expect(rows.map((row) => row.table_id)).toEqual([2, 7, 12]);
    expect(rows.every((row) => row.updated_at === "end-time")).toBe(true);
  });

  it("uses one fallback RPC for archive, board clear, and lifecycle clear", async () => {
    // Contract updated 11.07: the seam returns { rows, superseded } and the
    // RPC carries the (optional) identity of the service being ended.
    const rpc = vi.fn(async () => ({ data: { superseded: false }, error: null }));
    const archive = { id: "archive-1", date: "2026-07-10", label: "Dinner", state: { tables: [] } };
    const { rows, superseded } = await finishServiceStore({
      client: { rpc }, workspaceId: "ws-1", sqlitePrimary: false, archive,
    });
    expect(rows).toHaveLength(10);
    expect(superseded).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("archive_and_finish_service", {
      p_workspace_id: "ws-1",
      p_archive_id: "archive-1",
      p_archive_date: "2026-07-10",
      p_archive_label: "Dinner",
      p_archive_state: { tables: [] },
      p_expected_started_at: null,
      p_expected_date: null,
    });
  });

  it("does not let a failed transaction look successful", async () => {
    const failure = { code: "42501", message: "denied" };
    await expect(finishServiceStore({
      client: { rpc: async () => ({ data: null, error: failure }) },
      workspaceId: "ws-1",
      sqlitePrimary: false,
    })).rejects.toBe(failure);
  });
});
