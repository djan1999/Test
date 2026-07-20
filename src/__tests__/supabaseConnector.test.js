import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the shared supabase client so uploadData's PostgREST calls are captured
// instead of hitting the network. `h` is hoisted because vi.mock factories run
// before module init.
const h = vi.hoisted(() => ({
  calls: [],
  errorFor: () => null,
  workspaceId: "ws-active",
  session: { access_token: "tok-1" },
  remoteServiceTable: null,
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    from: (table) => {
      const record = (op, extra) => {
        const call = { table, op, ...extra };
        h.calls.push(call);
        return Promise.resolve({ error: h.errorFor(call) });
      };
      const read = {
        eq: () => read,
        maybeSingle: async () => ({ data: h.remoteServiceTable, error: null }),
      };
      return {
        select: () => read,
        upsert: (payload, opts) => record("upsert", { payload, opts }),
        insert: (payload) => record("insert", { payload }),
        update: (payload) => ({ match: (match) => record("update", { payload, match }) }),
        delete: () => ({ match: (match) => record("delete", { match }) }),
      };
    },
    rpc: (name, payload) => {
      const call = { table: "service_tables", op: "rpc", name, payload };
      h.calls.push(call);
      return Promise.resolve({ data: h.rpcData ?? true, error: h.errorFor(call) });
    },
    auth: { getSession: async () => ({ data: { session: h.session }, error: null }) },
  },
  getWorkspaceId: () => h.workspaceId,
}));

import { SupabaseConnector } from "../powersync/SupabaseConnector.js";

const makeTx = (crud) => ({ crud, complete: vi.fn(async () => {}) });
const makeDb = (tx) => ({ getNextCrudTransaction: async () => tx });

const put = (table, id, opData) => ({ op: "PUT", table, id, opData });
const patch = (table, id, opData) => ({ op: "PATCH", table, id, opData });
const del = (table, id, previousValues) => ({ op: "DELETE", table, id, previousValues });

beforeEach(() => {
  h.calls = [];
  h.errorFor = () => null;
  h.workspaceId = "ws-active";
  h.session = { access_token: "tok-1" };
  h.remoteServiceTable = null;
  h.rpcData = null;
  vi.restoreAllMocks();
});

describe("SupabaseConnector.uploadData — natural-key rebuild per table", () => {
  it("uploads an end-service SQLite batch through one atomic Postgres RPC", async () => {
    const workspace_id = "ws-a";
    const crud = [put("service_archive", "archive-1", {
      workspace_id,
      date: "2026-07-10",
      label: "10. 07. 2026 – DINNER",
      state: '{"tables":[]}',
      created_at: "2026-07-10T23:00:00Z",
    })];
    for (let table_id = 1; table_id <= 10; table_id += 1) {
      crud.push(patch("service_tables", `${workspace_id}|${table_id}`, {
        workspace_id, table_id, data: "{}", updated_at: "2026-07-10T23:00:01Z",
      }));
    }
    crud.push(patch("service_settings", `${workspace_id}|service_date`, {
      workspace_id, id: "service_date", state: "{}", updated_at: "2026-07-10T23:00:01Z",
    }));
    const tx = makeTx(crud);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("archive_and_finish_service");
    expect(h.calls[0].payload).toEqual({
      p_workspace_id: workspace_id,
      p_archive_id: "archive-1",
      p_archive_date: "2026-07-10",
      p_archive_label: "10. 07. 2026 – DINNER",
      p_archive_state: { tables: [] },
      p_expected_started_at: null,
      p_expected_date: null,
    });
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("passes the ended service's identity from tracked previousValues so the server guard engages", async () => {
    const workspace_id = "ws-a";
    const crud = Array.from({ length: 10 }, (_, index) => patch(
      "service_tables", `${workspace_id}|${index + 1}`,
      { workspace_id, table_id: index + 1, data: "{}" },
    ));
    crud.push({
      op: "PATCH",
      table: "service_settings",
      id: `${workspace_id}|service_date`,
      opData: { workspace_id, id: "service_date", state: "{}" },
      previousValues: {
        workspace_id,
        id: "service_date",
        state: '{"date":"2026-07-18","chosenOn":"2026-07-18","session":"lunch","startedAt":"2026-07-18T09:12:00.000Z"}',
      },
    });
    const tx = makeTx(crud);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("archive_and_finish_service");
    expect(h.calls[0].payload.p_expected_started_at).toBe("2026-07-18T09:12:00.000Z");
    expect(h.calls[0].payload.p_expected_date).toBe("2026-07-18");
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("completes a superseded finish without wiping — the queued blanks are dropped, not replayed", async () => {
    h.rpcData = { superseded: true };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const workspace_id = "ws-a";
    const crud = Array.from({ length: 10 }, (_, index) => patch(
      "service_tables", `${workspace_id}|${index + 1}`,
      { workspace_id, table_id: index + 1, data: "{}" },
    ));
    crud.push({
      op: "PATCH",
      table: "service_settings",
      id: `${workspace_id}|service_date`,
      opData: { workspace_id, id: "service_date", state: "{}" },
      previousValues: {
        workspace_id, id: "service_date",
        state: '{"date":"2026-07-18","startedAt":"2026-07-18T09:12:00.000Z"}',
      },
    });
    const tx = makeTx(crud);

    await new SupabaseConnector().uploadData(makeDb(tx));

    // One RPC, no fallthrough into per-op uploads, transaction completed so
    // the stale finish never replays against the newer live service.
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("archive_and_finish_service");
    expect(tx.complete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("recognizes an atomic end for a custom table set", async () => {
    const workspace_id = "ws-a";
    const crud = [2, 7, 12].map((table_id) => patch(
      "service_tables", `${workspace_id}|${table_id}`,
      { workspace_id, table_id, data: "{}", updated_at: "end" },
    ));
    crud.push(patch("service_settings", `${workspace_id}|service_date`, {
      workspace_id, id: "service_date", state: "{}", updated_at: "end",
    }));
    const tx = makeTx(crud);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("archive_and_finish_service");
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps an atomic end-service batch queued when its server RPC fails", async () => {
    h.errorFor = (call) => call.name === "archive_and_finish_service"
      ? { code: "", message: "network down" }
      : null;
    const workspace_id = "ws-a";
    const crud = Array.from({ length: 10 }, (_, index) => patch(
      "service_tables", `${workspace_id}|${index + 1}`,
      { workspace_id, table_id: index + 1, data: "{}" },
    ));
    crud.push(patch("service_settings", `${workspace_id}|service_date`, {
      workspace_id, id: "service_date", state: "{}",
    }));
    const tx = makeTx(crud);

    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toBeTruthy();
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("service_tables PUT → compare-and-swap RPC with parsed jsonb and workspace-safe id", async () => {
    const tx = makeTx([put("service_tables", "ws-a|3", {
      id: "ws-a|3", table_id: 3, data: '{"resName":"Kovač","seats":[]}',
      updated_at: "2026-06-06T18:00:00Z", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    const c = h.calls[0];
    expect(c.op).toBe("rpc");
    expect(c.name).toBe("save_service_table_if_current");
    expect(c.payload.p_table_id).toBe(3);
    expect(c.payload.p_data).toEqual({ resName: "Kovač", seats: [] });
    expect(c.payload.p_workspace_id).toBe("ws-a");
    expect(c.payload.p_expected_updated_at).toBeNull();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("service_tables PATCH → compare-and-swap RPC matched on the natural key", async () => {
    const tx = makeTx([patch("service_tables", "ws-active|7", { data: "{}", updated_at: "t" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("rpc");
    expect(c.payload.p_table_id).toBe(7);
    expect(c.payload.p_data).toEqual({});
  });

  it("merges different-seat concurrent edits before the compare-and-swap", async () => {
    h.remoteServiceTable = {
      data: { id: 3, resName: "A", seats: [{ id: 1, water: "Still" }, { id: 2, water: "Sparkling" }] },
      updated_at: "2026-07-10T18:00:01Z",
    };
    const tx = makeTx([{
      ...patch("service_tables", "ws-a|3", {
        table_id: 3,
        data: JSON.stringify({ id: 3, resName: "A", seats: [{ id: 1, water: "Tap" }, { id: 2, water: "Still" }] }),
        workspace_id: "ws-a",
      }),
      previousValues: {
        workspace_id: "ws-a",
        data: JSON.stringify({ id: 3, resName: "A", seats: [{ id: 1, water: "Still" }, { id: 2, water: "Still" }] }),
      },
    }]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls[0].payload.p_data.seats).toEqual([
      { id: 1, water: "Tap" },
      { id: 2, water: "Sparkling" },
    ]);
  });

  it("REGRESSION (09.07): reservations PATCH without date → UPDATE by id, NOT an upsert", async () => {
    // Upserting a partial PATCH builds an INSERT tuple with NULL date, and
    // Postgres checks NOT NULL on that tuple even though the row exists —
    // 23502 → permanent skip → the next checkpoint reverted the device
    // ("assigned a terrace table, then it unassigned itself").
    const tx = makeTx([patch("reservations", "uuid-1", {
      data: '{"resName":"Smith","visit_state":"terrace_seated","terrace_table":"KV"}',
      workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("update");
    expect(c.match).toEqual({ id: "uuid-1", workspace_id: "ws-a" });
    expect(c.payload.data).toEqual({ resName: "Smith", visit_state: "terrace_seated", terrace_table: "KV" });
    expect("id" in c.payload).toBe(false);
    expect("date" in c.payload).toBe(false); // absent column stays absent — never NULLed
  });

  it("REGRESSION (09.07): service_archive PATCH (soft-delete) → UPDATE by id", async () => {
    const tx = makeTx([patch("service_archive", "uuid-a", {
      deleted_at: "2026-07-09T10:00:00Z", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("update");
    expect(c.match).toEqual({ id: "uuid-a", workspace_id: "ws-a" });
    expect(c.payload.deleted_at).toBe("2026-07-09T10:00:00Z");
  });

  it("menu_courses PUT → upsert on workspace_id,position with 0/1→boolean and jsonb parsing", async () => {
    const tx = makeTx([put("menu_courses", "4", {
      position: "4", menu: '{"name":"Trout","sub":"fennel"}', is_snack: 0,
      show_on_short: 1, is_active: 1, restrictions_si: null,
      kitchen_note: "fire on call", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const { payload, opts } = h.calls[0];
    expect(opts).toEqual({ onConflict: "workspace_id,position" });
    expect(payload.position).toBe(4);
    expect(payload.menu).toEqual({ name: "Trout", sub: "fennel" });
    expect(payload.is_snack).toBe(false);
    expect(payload.show_on_short).toBe(true);
    expect(payload.is_active).toBe(true);
    expect(payload.restrictions_si).toBe(null);
    expect(payload.kitchen_note).toBe("fire on call"); // plain text stays text
  });

  it("wines PUT → upsert on workspace_id,key with by_glass boolean and key from op id", async () => {
    const tx = makeTx([put("wines", "manual|rebula", {
      producer: "Simčič", name: "Simčič – Rebula", wine_name: "Rebula",
      vintage: "2022", by_glass: 1, source: "manual", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const { payload, opts } = h.calls[0];
    expect(opts).toEqual({ onConflict: "workspace_id,key" });
    expect(payload.key).toBe("manual|rebula");
    expect(payload.by_glass).toBe(true);
  });

  it("service_settings PUT keeps id as the natural key (not stripped)", async () => {
    const tx = makeTx([put("service_settings", "menu_logo", {
      id: "menu_logo", state: '{"dataUri":"data:x"}', updated_at: "t", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const { payload, opts } = h.calls[0];
    expect(opts).toEqual({ onConflict: "workspace_id,id" });
    expect(payload.id).toBe("menu_logo");
    expect(payload.state).toEqual({ dataUri: "data:x" });
  });

  it("reservations PUT → upsert on id with the uuid preserved", async () => {
    const tx = makeTx([put("reservations", "uuid-1", {
      date: "2026-06-06", table_id: 2, data: '{"resName":"Smith"}',
      created_at: "t", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const { payload, opts } = h.calls[0];
    expect(opts).toEqual({ onConflict: "id" });
    expect(payload.id).toBe("uuid-1");
    expect(payload.data).toEqual({ resName: "Smith" });
  });
});

describe("SupabaseConnector.uploadData — beverages (server-generated identity)", () => {
  it("PUT with a local placeholder id inserts WITHOUT an id", async () => {
    const tx = makeTx([put("beverages", "local-uuid", {
      category: "cocktail", name: "Negroni", notes: "", position: 0,
      source: "manual", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("insert");
    expect("id" in c.payload).toBe(false);
    expect(c.payload.name).toBe("Negroni");
  });

  it("PATCH with a numeric (synced) id updates by id + workspace", async () => {
    const tx = makeTx([patch("beverages", "42", { notes: "stirred", workspace_id: "ws-a" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("update");
    expect(c.match).toEqual({ id: 42, workspace_id: "ws-a" });
  });

  it("DELETE with a local-only id is skipped as permanent, rest of tx continues", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = makeTx([
      del("beverages", "local-uuid"),
      del("beverages", "42"),
    ]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].op).toBe("delete");
    expect(h.calls[0].match).toEqual({ id: 42, workspace_id: "ws-active" });
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });
});

describe("SupabaseConnector.uploadData — deletes", () => {
  it("wines DELETE uses tracked previousValues for key + workspace over the active workspace", async () => {
    h.workspaceId = "ws-current";
    const tx = makeTx([del("wines", "old-key", { key: "old-key", workspace_id: "ws-previous" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls[0].op).toBe("delete");
    expect(h.calls[0].match).toEqual({ key: "old-key", workspace_id: "ws-previous" });
  });

  it("menu_courses DELETE without previousValues falls back to op id + active workspace", async () => {
    const tx = makeTx([del("menu_courses", "9")]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls[0].match).toEqual({ position: 9, workspace_id: "ws-active" });
  });

  it("reservations DELETE matches on uuid id + workspace", async () => {
    const tx = makeTx([del("reservations", "uuid-9", { workspace_id: "ws-a" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls[0].match).toEqual({ id: "uuid-9", workspace_id: "ws-a" });
  });
});

describe("SupabaseConnector.uploadData — error policy", () => {
  it("permanent Postgres errors (constraint 23505) log + skip + complete", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.errorFor = (call) => (call.table === "menu_courses" ? { code: "23505", message: "dup" } : null);
    const tx = makeTx([
      put("menu_courses", "1", { position: 1, workspace_id: "ws-a" }),
      put("service_tables", "1", { table_id: 1, data: "{}", workspace_id: "ws-a" }),
    ]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(2); // both attempted
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1); // queue never wedges
  });

  it("transient errors rethrow WITHOUT completing, so the engine retries", async () => {
    h.errorFor = () => ({ code: "", message: "fetch failed" });
    const tx = makeTx([put("service_tables", "1", { table_id: 1, data: "{}", workspace_id: "ws-a" })]);
    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toBeTruthy();
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("never drops an operational write when its required RPC/migration is missing", async () => {
    h.errorFor = (call) => call.op === "rpc"
      ? { code: "PGRST202", message: "save_service_table_if_current not found" }
      : null;
    const tx = makeTx([put("service_tables", "ws-a|1", {
      table_id: 1, data: "{}", workspace_id: "ws-a",
    })]);
    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toBeTruthy();
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("unknown tables are skipped as permanent", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = makeTx([put("not_a_table", "1", { workspace_id: "ws-a" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("an op with no resolvable workspace is skipped, never uploaded unscoped", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.workspaceId = null;
    const tx = makeTx([del("service_tables", "3")]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("no pending transaction is a no-op", async () => {
    await expect(new SupabaseConnector().uploadData(makeDb(null))).resolves.toBeUndefined();
  });
});

describe("SupabaseConnector.fetchCredentials", () => {
  it("returns endpoint + token for a live session", async () => {
    const creds = await new SupabaseConnector().fetchCredentials();
    expect(creds.token).toBe("tok-1");
    expect(typeof creds.endpoint).toBe("string");
  });

  it("returns null with no session so PowerSync waits for login", async () => {
    h.session = null;
    const creds = await new SupabaseConnector().fetchCredentials();
    expect(creds).toBeNull();
  });
});
