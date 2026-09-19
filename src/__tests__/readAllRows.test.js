import { describe, expect, it, vi } from "vitest";
import { readAllRows } from "../lib/readAllRows.js";

describe("complete paginated snapshots", () => {
  it("loads beyond the server response cap, including the final partial page", async () => {
    const rows = Array.from({ length: 1234 }, (_, id) => ({ id }));
    const range = vi.fn(async (lo, hi) => ({ data: rows.slice(lo, hi + 1) }));
    expect(await readAllRows(() => ({ range }))).toEqual(rows);
    expect(range).toHaveBeenCalledTimes(3);
  });
  it("rejects the whole snapshot when a later page fails", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ error: new Error("connection lost") });
    await expect(readAllRows(() => ({ range }), 2)).rejects.toThrow("connection lost");
  });
});
