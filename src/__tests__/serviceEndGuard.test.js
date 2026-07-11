// finishServiceStore — the identity-checked end-of-service seam (11.07).
// The store refuses the WHOLE end (archive + board blank + date clear) when
// it no longer holds the service being ended; the fallback path forwards the
// identity to the archive_and_finish_service RPC and honors its verdict.

import { describe, it, expect, vi } from "vitest";
import { finishServiceStore } from "../lib/serviceLifecycleStore.js";

describe("finishServiceStore — fallback identity guard", () => {
  it("forwards the expected service identity to the RPC", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { superseded: false }, error: null }) };
    const res = await finishServiceStore({
      client, workspaceId: "ws-1", sqlitePrimary: false,
      archive: { id: "a1", date: "2026-07-11", label: "L", state: {} },
      expected: { startedAt: "S1", date: "2026-07-11" },
    });
    expect(client.rpc).toHaveBeenCalledWith("archive_and_finish_service", expect.objectContaining({
      p_workspace_id: "ws-1",
      p_archive_id: "a1",
      p_expected_started_at: "S1",
      p_expected_date: "2026-07-11",
    }));
    expect(res.superseded).toBe(false);
    expect(res.rows).toHaveLength(10);
  });

  it("a superseded verdict from the store comes back as superseded — the caller must not clear anything", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { superseded: true }, error: null }) };
    const res = await finishServiceStore({
      client, workspaceId: "ws-1", sqlitePrimary: false,
      expected: { startedAt: "STALE" },
    });
    expect(res.superseded).toBe(true);
  });

  it("no identity → unguarded legacy call (nulls forwarded, old void response tolerated)", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const res = await finishServiceStore({ client, workspaceId: "ws-1", sqlitePrimary: false });
    expect(client.rpc).toHaveBeenCalledWith("archive_and_finish_service", expect.objectContaining({
      p_expected_started_at: null,
      p_expected_date: null,
    }));
    expect(res.superseded).toBe(false);
  });

  it("RPC errors still throw to the caller (persistServiceEnd turns them into ok:false)", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("down") }) };
    await expect(finishServiceStore({ client, workspaceId: "ws-1", sqlitePrimary: false }))
      .rejects.toThrow("down");
  });
});
