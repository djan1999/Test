import { describe, expect, it, vi } from "vitest";
import { finishServiceStore, makeBlankServiceRows } from "../lib/serviceLifecycleStore.js";

describe("service lifecycle store", () => {
  it("builds all ten blank rows with one shared timestamp", () => {
    const rows = makeBlankServiceRows("end-time");
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.table_id)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(rows.every((row) => row.updated_at === "end-time" && Object.keys(row.data).length === 0)).toBe(true);
  });

  it("uses one fallback RPC for archive, board clear, and lifecycle clear", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const archive = { id: "archive-1", date: "2026-07-10", label: "Dinner", state: { tables: [] } };
    const rows = await finishServiceStore({
      client: { rpc }, workspaceId: "ws-1", sqlitePrimary: false, archive,
    });
    expect(rows).toHaveLength(10);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("archive_and_finish_service", {
      p_workspace_id: "ws-1",
      p_archive_id: "archive-1",
      p_archive_date: "2026-07-10",
      p_archive_label: "Dinner",
      p_archive_state: { tables: [] },
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
