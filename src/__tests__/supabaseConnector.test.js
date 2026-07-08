import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the shared supabase client so uploadData's PostgREST calls are captured
// instead of hitting the network. `h` is hoisted because vi.mock factories run
// before module init.
const h = vi.hoisted(() => ({
  calls: [],
  errorFor: () => null,
  workspaceId: "ws-active",
  session: { access_token: "tok-1" },
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    from: (table) => {
      const record = (op, extra) => {
        const call = { table, op, ...extra };
        h.calls.push(call);
        return Promise.resolve({ error: h.errorFor(call) });
      };
      return {
        upsert: (payload, opts) => record("upsert", { payload, opts }),
        insert: (payload) => record("insert", { payload }),
        update: (payload) => ({ match: (match) => record("update", { payload, match }) }),
        delete: () => ({ match: (match) => record("delete", { match }) }),
      };
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
  vi.restoreAllMocks();
});

describe("SupabaseConnector.uploadData — natural-key rebuild per table", () => {
  it("service_tables PUT → upsert on workspace_id,table_id with parsed jsonb and no id column", async () => {
    const tx = makeTx([put("service_tables", "3", {
      id: "3", table_id: 3, data: '{"resName":"Kovač","seats":[]}',
      updated_at: "2026-06-06T18:00:00Z", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    const c = h.calls[0];
    expect(c.op).toBe("upsert");
    expect(c.opts).toEqual({ onConflict: "workspace_id,table_id" });
    expect(c.payload.table_id).toBe(3);
    expect(c.payload.data).toEqual({ resName: "Kovač", seats: [] });
    expect(c.payload.workspace_id).toBe("ws-a");
    expect("id" in c.payload).toBe(false);
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("service_tables PATCH → plain UPDATE matched on the natural key (never an upsert)", async () => {
    const tx = makeTx([patch("service_tables", "7", { data: "{}", updated_at: "t" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.op).toBe("update");
    expect(c.match).toEqual({ table_id: 7, workspace_id: "ws-active" }); // falls back to active workspace
    expect(c.payload.data).toEqual({});
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
