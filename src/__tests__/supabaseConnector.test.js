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
  remoteServiceTables: {},
  remoteServiceSetting: null,
  remoteReservation: null,
  rpcResponses: {},
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {
    from: (table) => {
      const record = (op, extra) => {
        const call = { table, op, ...extra };
        h.calls.push(call);
        return Promise.resolve({ error: h.errorFor(call) });
      };
      const filters = {};
      const read = {
        eq: (column, value) => { filters[column] = value; return read; },
        maybeSingle: async () => ({
          data: table === "service_settings"
            ? h.remoteServiceSetting
            : table === "reservations"
              ? h.remoteReservation
              : (h.remoteServiceTables[filters.table_id] ?? h.remoteServiceTable),
          error: null,
        }),
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
      const queued = h.rpcResponses[name];
      const data = Array.isArray(queued) && queued.length ? queued.shift() : (h.rpcData ?? true);
      return Promise.resolve({ data, error: h.errorFor(call) });
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
  h.remoteServiceTables = {};
  h.remoteServiceSetting = null;
  h.remoteReservation = null;
  h.rpcResponses = {};
  h.rpcData = null;
  vi.restoreAllMocks();
});

describe("SupabaseConnector.uploadData — natural-key rebuild per table", () => {
  it("a queued END uploads as ONE services UPDATE by id — no RPC, no board writes (wipe-impossibility)", async () => {
    // Entity model: an offline device's late END is a single-row status flip
    // addressed by the OLD service's uuid. There is no transaction-collapse
    // RPC and no blanking op left; the newer live service cannot be touched.
    const tx = makeTx([patch("services", "svc-old", {
      status: "ended", ended_at: "2026-07-22T23:00:00Z", end_reason: "manual",
      updated_at: "2026-07-22T23:00:00Z", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      table: "services",
      op: "update",
      match: { id: "svc-old", workspace_id: "ws-a" },
    });
    expect(h.calls[0].payload.status).toBe("ended");
    expect(h.calls.some((c) => c.table === "service_tables")).toBe(false);
    expect(h.calls.some((c) => c.name === "archive_and_finish_service")).toBe(false);
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("a queued START uploads as a services upsert on its uuid", async () => {
    const tx = makeTx([put("services", "svc-new", {
      date: "2026-07-23", session: "dinner", chosen_on: "2026-07-23",
      started_at: "2026-07-23T16:00:00Z", status: "live",
      snapshot: null, updated_at: "u", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ table: "services", op: "upsert" });
    expect(h.calls[0].payload.id).toBe("svc-new");
    expect(h.calls[0].payload.status).toBe("live");
    expect(h.calls[0].opts).toEqual({ onConflict: "id" });
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps a queued services write when the server fails (never dropped)", async () => {
    h.errorFor = (call) => (call.table === "services" ? { code: "", message: "network down" } : null);
    const tx = makeTx([patch("services", "svc-old", {
      status: "ended", workspace_id: "ws-a",
    })]);
    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toBeTruthy();
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("service_tables PUT → compare-and-swap RPC with parsed jsonb and the (service, table) key", async () => {
    const tx = makeTx([put("service_tables", "ws-a|svc-1|3", {
      id: "ws-a|svc-1|3", service_id: "svc-1", table_id: 3, data: '{"resName":"Kovač","seats":[]}',
      updated_at: "2026-06-06T18:00:00Z", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1); // reads aren't recorded — just the RPC
    const c = h.calls.find((call) => call.op === "rpc");
    expect(c.name).toBe("save_service_table_if_current");
    expect(c.payload.p_service_id).toBe("svc-1");
    expect(c.payload.p_table_id).toBe(3);
    expect(c.payload.p_data).toEqual({ resName: "Kovač", seats: [] });
    expect(c.payload.p_workspace_id).toBe("ws-a");
    expect(c.payload.p_expected_updated_at).toBeNull();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("service_tables PATCH → the (service, table) key is restored from the local id alias", async () => {
    const tx = makeTx([patch("service_tables", "ws-active|svc-9|7", { data: "{}", updated_at: "t" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls.find((call) => call.op === "rpc");
    expect(c.payload.p_service_id).toBe("svc-9");
    expect(c.payload.p_table_id).toBe(7);
    expect(c.payload.p_data).toEqual({});
  });

  it("service_tables op with NO resolvable service is skipped as permanent — never guessed", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = makeTx([patch("service_tables", "7", { data: "{}", updated_at: "t" })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls.filter((c) => c.op === "rpc")).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("merges different-seat concurrent edits before the compare-and-swap", async () => {
    h.remoteServiceTable = {
      data: { id: 3, resName: "A", seats: [{ id: 1, water: "Still" }, { id: 2, water: "Sparkling" }] },
      updated_at: "2026-07-10T18:00:01Z",
    };
    const tx = makeTx([{
      ...patch("service_tables", "ws-a|svc-1|3", {
        service_id: "svc-1",
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
    const c = h.calls.find((call) => call.op === "rpc");
    expect(c.payload.p_data.seats).toEqual([
      { id: 1, water: "Tap" },
      { id: 2, water: "Sparkling" },
    ]);
  });

  it("uploads a MOVE destination first and keeps the source when that destination became occupied", async () => {
    const blank = { id: 7, active: false, resName: "", resTime: "", seats: [] };
    const alphaAtSource = { id: 3, active: true, resName: "ALPHA", resTime: "19:00", seats: [] };
    const alphaAtDestination = { ...alphaAtSource, id: 7 };
    const betaAtDestination = { id: 7, active: true, resName: "BETA", resTime: "19:15", seats: [] };
    h.remoteServiceTables = {
      3: { data: alphaAtSource, updated_at: "2026-07-20T18:00:00.000Z" },
      7: { data: betaAtDestination, updated_at: "2026-07-20T18:00:01.000Z" },
    };
    const sourceBlank = {
      ...patch("service_tables", "ws-a|svc-1|3", {
        service_id: "svc-1", table_id: 3, data: JSON.stringify({ ...blank, id: 3 }), workspace_id: "ws-a",
      }),
      previousValues: { workspace_id: "ws-a", data: JSON.stringify(alphaAtSource) },
    };
    const destinationClaim = {
      ...patch("service_tables", "ws-a|svc-1|7", {
        service_id: "svc-1", table_id: 7, data: JSON.stringify(alphaAtDestination), workspace_id: "ws-a",
      }),
      previousValues: { workspace_id: "ws-a", data: JSON.stringify(blank) },
    };
    // Deliberately source-first: the connector must reorder this safely.
    const tx = makeTx([sourceBlank, destinationClaim]);

    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toMatchObject({
      code: "MILKA_TABLE_CONFLICT",
      conflict: "destination-occupied",
    });

    // Only the destination's CAS read ran — no overwrite, no source clear RPC.
    expect(h.calls.filter((c) => c.op === "rpc")).toHaveLength(0);
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("REGRESSION (09.07): reservations PATCH without date keeps the stored date through CAS", async () => {
    // Upserting a partial PATCH builds an INSERT tuple with NULL date, and
    // Postgres checks NOT NULL on that tuple even though the row exists —
    // 23502 → permanent skip → the next checkpoint reverted the device
    // ("assigned a terrace table, then it unassigned itself").
    h.remoteReservation = {
      date: "2026-07-09",
      table_id: 3,
      data: { resName: "Smith", visit_state: "booked" },
      created_at: "2026-07-01T12:00:00Z",
    };
    const tx = makeTx([patch("reservations", "uuid-1", {
      data: '{"resName":"Smith","visit_state":"terrace_seated","terrace_table":"KV"}',
      workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const c = h.calls[0];
    expect(c.name).toBe("save_reservation_if_current");
    expect(c.payload.p_expected_date).toBe("2026-07-09");
    expect(c.payload.p_date).toBe("2026-07-09"); // absent PATCH column inherited — never NULLed
    expect(c.payload.p_table_id).toBe(3);
    expect(c.payload.p_data).toMatchObject({
      resName: "Smith",
      visit_state: "terrace_seated",
      terrace_table: "KV",
    });
  });

  it("merges a planner edit with a concurrent terrace transition", async () => {
    const ancestorData = {
      resName: "ALPHA",
      guests: 2,
      visit_state: "booked",
      terrace_table: null,
      terrace_map_id: null,
      restrictions: [],
    };
    h.remoteReservation = {
      date: "2026-07-20",
      table_id: 3,
      data: { ...ancestorData, guests: 3 },
      created_at: "2026-07-01T12:00:00Z",
    };
    const tx = makeTx([{
      ...patch("reservations", "uuid-merge", {
        data: JSON.stringify({
          ...ancestorData,
          visit_state: "terrace",
          terrace_table: "KV",
          terrace_map_id: "terrace-a",
        }),
        workspace_id: "ws-a",
      }),
      previousValues: {
        workspace_id: "ws-a",
        date: "2026-07-20",
        table_id: 3,
        data: JSON.stringify(ancestorData),
        created_at: "2026-07-01T12:00:00Z",
      },
    }]);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls[0].payload.p_data).toMatchObject({
      guests: 3,
      visit_state: "terrace",
      terrace_table: "KV",
    });
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

  it("floor-status upload merges independent markers before its version-checked save", async () => {
    h.remoteServiceSetting = {
      state: {
        dining: { T1: "SET" },
        terrace: { T21: "SET" },
      },
      updated_at: "2026-07-20T18:00:01.000Z",
    };
    const tx = makeTx([{
      ...patch("service_settings", "ws-a|floor_status_v1", {
        id: "floor_status_v1",
        state: JSON.stringify({ dining: { T1: "SET", T2: "SET" } }),
        workspace_id: "ws-a",
      }),
      previousValues: {
        workspace_id: "ws-a",
        id: "floor_status_v1",
        state: JSON.stringify({ dining: { T1: "SET" } }),
      },
    }]);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe("save_service_setting_if_current");
    expect(h.calls[0].payload.p_expected_updated_at).toBe("2026-07-20T18:00:01.000Z");
    expect(h.calls[0].payload.p_state).toEqual({
      dining: { T1: "SET", T2: "SET" },
      terrace: { T21: "SET" },
    });
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("retries a floor-setting save when another device wins the version race", async () => {
    h.remoteServiceSetting = {
      state: { dining: { T1: "SET" } },
      updated_at: "2026-07-20T18:00:01.000Z",
    };
    h.rpcResponses.save_service_setting_if_current = [false, true];
    const tx = makeTx([{
      ...patch("service_settings", "ws-a|floor_status_v1", {
        id: "floor_status_v1",
        state: JSON.stringify({ dining: { T1: "SET", T2: "SET" } }),
        workspace_id: "ws-a",
      }),
      previousValues: {
        workspace_id: "ws-a",
        state: JSON.stringify({ dining: { T1: "SET" } }),
      },
    }]);

    await new SupabaseConnector().uploadData(makeDb(tx));

    expect(h.calls.filter(({ name }) => name === "save_service_setting_if_current")).toHaveLength(2);
    expect(tx.complete).toHaveBeenCalledTimes(1);
  });

  it("reservations PUT → version-checked insert with the uuid preserved", async () => {
    const tx = makeTx([put("reservations", "uuid-1", {
      date: "2026-06-06", table_id: 2, data: '{"resName":"Smith"}',
      created_at: "t", workspace_id: "ws-a",
    })]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    const { name, payload } = h.calls[0];
    expect(name).toBe("save_reservation_if_current");
    expect(payload.p_id).toBe("uuid-1");
    expect(payload.p_expected_date).toBeNull();
    expect(payload.p_data).toEqual({ resName: "Smith" });
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
      put("service_tables", "ws-a|svc-1|1", { service_id: "svc-1", table_id: 1, data: "{}", workspace_id: "ws-a" }),
    ]);
    await new SupabaseConnector().uploadData(makeDb(tx));
    expect(h.calls).toHaveLength(2); // both attempted
    expect(errSpy).toHaveBeenCalled();
    expect(tx.complete).toHaveBeenCalledTimes(1); // queue never wedges
  });

  it("transient errors rethrow WITHOUT completing, so the engine retries", async () => {
    h.errorFor = () => ({ code: "", message: "fetch failed" });
    const tx = makeTx([put("service_tables", "ws-a|svc-1|1", {
      service_id: "svc-1", table_id: 1, data: "{}", workspace_id: "ws-a",
    })]);
    await expect(new SupabaseConnector().uploadData(makeDb(tx))).rejects.toBeTruthy();
    expect(tx.complete).not.toHaveBeenCalled();
  });

  it("never drops an operational write when its required RPC/migration is missing", async () => {
    h.errorFor = (call) => call.op === "rpc"
      ? { code: "PGRST202", message: "save_service_table_if_current not found" }
      : null;
    const tx = makeTx([put("service_tables", "ws-a|svc-1|1", {
      service_id: "svc-1", table_id: 1, data: "{}", workspace_id: "ws-a",
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
