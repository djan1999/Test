// ── In-memory backend for the app-level integration harness ─────────────────
//
// Models the app's real storage topology with TWO stores:
//
//   backend.remote — what Supabase holds (the server)
//   backend.local  — what the on-device PowerSync SQLite DB holds
//
// The fake Supabase client reads/writes `remote`. The fake powersync modules
// read/write `local`, mirror every write to `remote` (the connector upload),
// and re-fire the registered watches after every local commit — exactly the
// loop that reverts a seam-bypassing direct-Supabase write on the SQLite-
// primary path (the PR #44 bug class). `syncDown()` copies remote → local and
// fires the watches, simulating another device's change arriving through the
// sync stream. Setting `connectorDown` queues uploads (device offline);
// `drainUploads()` is the reconnect. Setting `failRemoteWrites` makes remote
// mutations fail (fallback-path offline).
//
// The appHarness test file re-exports pieces of this module from its vi.mock
// factories, so the whole app import graph — App, scopedDb, stateStore,
// archiveStore, dynamic import()s — lands here.

const nowISO = () => new Date().toISOString();
const clone = (v) => (v == null ? v : structuredClone(v));

export const WORKSPACE_ID = "ws-harness";

const newStore = () => ({ tables: new Map() });
const tableOf = (store, name) => {
  if (!store.tables.has(name)) store.tables.set(name, []);
  return store.tables.get(name);
};

export const backend = {
  remote: newStore(),
  local: newStore(),
  psMode: false,          // drives isPowerSyncEnabled
  failRemoteWrites: false, // fallback-path offline: remote mutations error
  connectorDown: false,    // sqlite-path offline: uploads queue instead of mirroring
  uploadQueue: [],
  watch: null,             // { handlers, range } once App registers
  clearResyncs: 0,         // clearLocalAndResync invocations (contaminated-DB heal)
  lastOnStatus: null,      // the status callback App registered via connect()
};

// ── workspace singleton (mirrors the real supabaseClient module) ─────────────
let _workspaceId = null;
export const getWorkspaceId = () => _workspaceId;
export const setWorkspaceId = (id) => { _workspaceId = id || null; };

export function resetBackend({ psMode = false } = {}) {
  backend.remote = newStore();
  backend.local = newStore();
  backend.psMode = psMode;
  backend.failRemoteWrites = false;
  backend.connectorDown = false;
  backend.uploadQueue = [];
  backend.watch = null;
  backend.clearResyncs = 0;
  backend.lastOnStatus = null;
  _workspaceId = null;
  realtimeChannels.clear();
  localStorage.clear();
  sessionStorage.clear();
  // One member workspace → App auto-picks it after the auth bootstrap.
  tableOf(backend.remote, "workspaces").push({
    id: WORKSPACE_ID, name: "Harness Milka", kind: "member", slug: "harness",
  });
  // Harness scenarios exercise every operating surface, so this signed-in
  // account is an Admin (which also has Service and Kitchen access).
  tableOf(backend.remote, "workspace_members").push({
    workspace_id: WORKSPACE_ID,
    user_id: "user-harness",
    role: "admin",
    created_at: nowISO(),
  });
}

// Seed a table in BOTH stores (a fully synced device), stamping workspace_id.
export function seed(table, rows) {
  for (const store of [backend.remote, backend.local]) {
    tableOf(store, table).push(...rows.map((r) => clone({ workspace_id: WORKSPACE_ID, ...r })));
  }
}

export const remoteRows = (table) => tableOf(backend.remote, table);
export const localRows = (table) => tableOf(backend.local, table);

// ── fake PostgREST query builder over a store ────────────────────────────────
const asKey = (v) => (v == null ? v : String(v));
function makeBuilder(store, table) {
  const state = { op: null, filters: [], orders: [], limitN: null, single: false, maybe: false, payload: null, opts: null };
  const b = {};
  const chain = (fn) => (...args) => { fn(...args); return b; };

  b.select = chain(() => { if (state.op == null) state.op = "select"; });
  b.insert = chain((payload, opts) => { state.op = "insert"; state.payload = payload; state.opts = opts; });
  b.upsert = chain((payload, opts) => { state.op = "upsert"; state.payload = payload; state.opts = opts; });
  b.update = chain((payload, opts) => { state.op = "update"; state.payload = payload; state.opts = opts; });
  b.delete = chain(() => { state.op = "delete"; });
  b.eq = chain((col, val) => state.filters.push((r) => asKey(r[col]) === asKey(val)));
  b.gte = chain((col, val) => state.filters.push((r) => r[col] >= val));
  b.lte = chain((col, val) => state.filters.push((r) => r[col] <= val));
  b.in = chain((col, vals) => state.filters.push((r) => vals.map(asKey).includes(asKey(r[col]))));
  b.is = chain((col, val) => state.filters.push((r) => (val === null ? r[col] == null : r[col] === val)));
  b.not = chain((col, op, val) => {
    if (op === "is") state.filters.push((r) => !(val === null ? r[col] == null : r[col] === val));
    else if (op === "in") {
      const list = String(val).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      state.filters.push((r) => !list.includes(asKey(r[col])));
    } else throw new Error(`fake builder: unsupported not() op ${op}`);
  });
  b.order = chain((col, opts = {}) => state.orders.push({ col, asc: opts.ascending !== false }));
  b.limit = chain((n) => { state.limitN = n; });
  b.single = chain(() => { state.single = true; });
  b.maybeSingle = chain(() => { state.maybe = true; });

  const matches = (r) => state.filters.every((f) => f(r));

  const exec = async () => {
    const rows = tableOf(store, table);
    if (state.op !== "select" && store === backend.remote && backend.failRemoteWrites) {
      return { data: null, error: new Error("fake network: remote writes are failing") };
    }
    let data = null;
    if (state.op === "select" || state.op === null) {
      let out = rows.filter(matches);
      for (const { col, asc } of [...state.orders].reverse()) {
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (state.limitN != null) out = out.slice(0, state.limitN);
      data = clone(out);
    } else if (state.op === "insert") {
      const list = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((r) => ({
        id: crypto.randomUUID(), created_at: nowISO(), ...clone(r),
      }));
      rows.push(...list);
      data = clone(list);
    } else if (state.op === "upsert") {
      const keys = (state.opts?.onConflict || "id").split(",").map((s) => s.trim());
      const list = Array.isArray(state.payload) ? state.payload : [state.payload];
      const written = [];
      for (const r of list) {
        const hit = rows.find((row) => keys.every((k) => asKey(row[k]) === asKey(r[k])));
        if (hit) Object.assign(hit, clone(r));
        else rows.push({ id: crypto.randomUUID(), created_at: nowISO(), ...clone(r) });
        written.push(clone(r));
      }
      data = written;
    } else if (state.op === "update") {
      const hit = rows.filter(matches);
      hit.forEach((row) => Object.assign(row, clone(state.payload)));
      data = clone(hit);
    } else if (state.op === "delete") {
      const keep = rows.filter((r) => !matches(r));
      const removed = rows.length - keep.length;
      rows.length = 0; rows.push(...keep);
      data = removed;
    }
    if (state.single || state.maybe) {
      const first = Array.isArray(data) ? data[0] : data;
      if (first == null && state.single) return { data: null, error: new Error("PGRST116: no rows") };
      data = first ?? null;
    }
    return { data, error: null };
  };

  b.then = (onFulfilled, onRejected) => exec().then(onFulfilled, onRejected);
  return b;
}

// ── fake Supabase client ──────────────────────────────────────────────────────
const session = { user: { id: "user-harness", email: "harness@test" } };

// Realtime channels (postgres_changes). Channels register on subscribe();
// emitRealtime(table, payload) delivers a payload to every binding on that
// table — simulating another device's change arriving over the wire.
const realtimeChannels = new Map(); // name → { name, bindings: [{ binding, cb }] }
export function emitRealtime(table, payload) {
  for (const ch of realtimeChannels.values()) {
    for (const { binding, cb } of ch.bindings) {
      if (binding.table === table) cb(clone(payload));
    }
  }
}
export const subscribedChannelCount = () => realtimeChannels.size;

function makeChannel(name) {
  const ch = { name, bindings: [] };
  const api = {
    _name: name,
    on: (_type, binding, cb) => { ch.bindings.push({ binding, cb }); return api; },
    subscribe: (statusCb) => { realtimeChannels.set(name, ch); statusCb?.("SUBSCRIBED"); return api; },
    unsubscribe: () => { realtimeChannels.delete(name); },
  };
  return api;
}

export const fakeSupabase = {
  from: (table) => makeBuilder(backend.remote, table),
  rpc: async (name, args) => {
    if (backend.failRemoteWrites) return { data: null, error: new Error("fake network: remote writes are failing") };
    if (name === "save_service_table_if_current") {
      const rows = tableOf(backend.remote, "service_tables");
      const hit = rows.find((r) => r.workspace_id === args.p_workspace_id && Number(r.table_id) === Number(args.p_table_id));
      const expected = args.p_expected_updated_at ?? null;
      if ((!hit && expected != null) || (hit && expected == null) || (hit && hit.updated_at !== expected)) {
        return { data: false, error: null };
      }
      upsertInto(backend.remote, "service_tables", ["workspace_id", "table_id"], {
        workspace_id: args.p_workspace_id,
        table_id: Number(args.p_table_id),
        data: clone(args.p_data || {}),
        updated_at: args.p_updated_at || nowISO(),
      });
      return { data: true, error: null };
    }
    if (name === "archive_and_finish_service") {
      // Mirror the identity guard: when the caller names the service it is
      // ending and the store no longer holds it, the call is a full NO-OP.
      const expectedStarted = args.p_expected_started_at ?? null;
      const expectedDate = args.p_expected_date ?? null;
      if (expectedStarted != null || expectedDate != null) {
        const row = tableOf(backend.remote, "service_settings")
          .find((r) => r.workspace_id === args.p_workspace_id && r.id === "service_date");
        const state = row?.state || null;
        // A state with NO startedAt has no identity to mismatch — the date
        // decides alone (mirrors the production function).
        const startedOk = expectedStarted == null || state?.startedAt == null
          || state.startedAt === expectedStarted;
        const dateOk = expectedDate == null || state?.date === expectedDate;
        if (!state?.date || !startedOk || !dateOk) {
          return { data: { superseded: true }, error: null };
        }
      }
      applyFinishedServiceToStore(backend.remote, args.p_workspace_id, {
        archive: args.p_archive_id ? {
          id: args.p_archive_id,
          date: args.p_archive_date,
          label: args.p_archive_label,
          state: args.p_archive_state || {},
        } : null,
      });
      return { data: { superseded: false }, error: null };
    }
    return { data: null, error: null };
  },
  channel: (name) => makeChannel(name),
  removeChannel: (chApi) => { realtimeChannels.delete(chApi?._name); },
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}),
  },
};

// ── fake powersync: reads over backend.local ─────────────────────────────────
const wsRows = (table) => tableOf(backend.local, table).filter((r) => r.workspace_id === getWorkspaceId());

export const fakeReads = {
  whenSynced: async () => true,
  whenSyncedPriority: async () => true,
  readSetting: async (id) => clone(wsRows("service_settings").find((r) => asKey(r.id) === asKey(id))?.state ?? null),
  readLiveSettings: async () =>
    clone(wsRows("service_settings")
      .filter((r) => ["kitchen_ticket_order", "service_date", "floor_status_v1", "floor_maps_v1"].includes(r.id))
      .map((r) => ({ id: r.id, state: r.state, updated_at: r.updated_at }))),
  readServiceTables: async () =>
    clone(wsRows("service_tables").map((r) => ({ table_id: Number(r.table_id), data: r.data, updated_at: r.updated_at }))
      .sort((a, b) => a.table_id - b.table_id)),
  readReservations: async (from, to) =>
    clone(wsRows("reservations").filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created_at < b.created_at ? -1 : 1)))),
  readWines: async () => clone(wsRows("wines").map((r) => ({
    id: r.key, name: r.wine_name || r.name, producer: r.producer || "", vintage: r.vintage || "",
    region: r.region || "", country: r.country || "", byGlass: !!r.by_glass, source: r.source || "sync",
  }))),
  readBeverages: async () => clone([...wsRows("beverages")].sort((a, b) => (a.position || 0) - (b.position || 0))),
  readMenuCourses: async () => clone([...wsRows("menu_courses")].sort((a, b) => (a.position || 0) - (b.position || 0))),
  readActiveArchivesForDate: async (date) =>
    clone(wsRows("service_archive").filter((r) => r.date === date && r.deleted_at == null)
      .map((r) => ({ id: r.id, label: r.label, state: r.state, created_at: r.created_at }))),
  readServiceArchive: async () => ({
    active: clone(wsRows("service_archive").filter((r) => r.deleted_at == null)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 60)),
    deleted: clone(wsRows("service_archive").filter((r) => r.deleted_at != null)
      .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1)).slice(0, 30)),
  }),
};

// ── fake powersync: writes into backend.local + connector mirror ─────────────
// Every write commits locally, mirrors to remote (or queues when the connector
// is down), then re-fires the watches — the local-commit trigger.
const upsertInto = (store, table, keys, row) => {
  const rows = tableOf(store, table);
  const hit = rows.find((r) => keys.every((k) => asKey(r[k]) === asKey(row[k])));
  if (hit) Object.assign(hit, clone(row));
  else rows.push(clone(row));
};
const applyFinishedServiceToStore = (store, ws, { archive = null, blankRows = null } = {}) => {
  if (archive) {
    upsertInto(store, "service_archive", ["id"], {
      workspace_id: ws,
      id: archive.id,
      date: archive.date,
      label: archive.label,
      state: clone(archive.state || {}),
      created_at: nowISO(),
      deleted_at: null,
    });
  }
  const rows = blankRows || Array.from({ length: 10 }, (_, i) => ({
    table_id: i + 1,
    data: {},
    updated_at: nowISO(),
  }));
  for (const row of rows) {
    upsertInto(store, "service_tables", ["workspace_id", "table_id"], {
      workspace_id: ws,
      table_id: Number(row.table_id),
      data: clone(row.data || {}),
      updated_at: row.updated_at || nowISO(),
    });
  }
  upsertInto(store, "service_settings", ["workspace_id", "id"], {
    workspace_id: ws,
    id: "service_date",
    state: {},
    updated_at: nowISO(),
  });
};
const mirror = (apply) => {
  if (backend.connectorDown) backend.uploadQueue.push(apply);
  else apply(backend.remote);
};
export async function drainUploads() {
  const q = backend.uploadQueue;
  backend.uploadQueue = [];
  q.forEach((apply) => apply(backend.remote));
}

export async function fireWatches() {
  const w = backend.watch;
  if (!w) return;
  const { handlers, range } = w;
  if (handlers.onServiceTables) handlers.onServiceTables(await fakeReads.readServiceTables());
  if (handlers.onReservations) handlers.onReservations(await fakeReads.readReservations(range.from, range.to));
  if (handlers.onWines) handlers.onWines(await fakeReads.readWines());
  if (handlers.onBeverages) handlers.onBeverages(await fakeReads.readBeverages());
  if (handlers.onMenuCourses) handlers.onMenuCourses(await fakeReads.readMenuCourses());
  if (handlers.onLiveSettings) handlers.onLiveSettings(await fakeReads.readLiveSettings());
}

// Another device's change arriving through the sync stream: remote → local.
export async function syncDown() {
  backend.local = newStore();
  for (const [name, rows] of backend.remote.tables) tableOf(backend.local, name).push(...clone(rows));
  await fireWatches();
}

const requireWorkspace = () => {
  const ws = getWorkspaceId();
  if (!ws) throw new Error("fake writes: no workspace selected");
  return ws;
};

export const fakeWrites = {
  writeServiceTables: async (rows) => {
    const ws = requireWorkspace();
    for (const r of rows) {
      const row = { workspace_id: ws, table_id: Number(r.table_id), data: r.data, updated_at: r.updated_at || nowISO() };
      upsertInto(backend.local, "service_tables", ["workspace_id", "table_id"], row);
      mirror((store) => upsertInto(store, "service_tables", ["workspace_id", "table_id"], row));
    }
    await fireWatches();
  },
  writeSetting: async (id, state) => {
    const ws = requireWorkspace();
    const row = { workspace_id: ws, id, state, updated_at: nowISO() };
    upsertInto(backend.local, "service_settings", ["workspace_id", "id"], row);
    mirror((store) => upsertInto(store, "service_settings", ["workspace_id", "id"], row));
    await fireWatches();
  },
  writeReservation: async ({ id, date, table_id, data, created_at }) => {
    const ws = requireWorkspace();
    const rows = tableOf(backend.local, "reservations");
    const hit = rows.find((r) => asKey(r.id) === asKey(id) && r.workspace_id === ws);
    const row = hit
      ? { ...hit, date, table_id, data: clone(data), updated_at: nowISO() }
      : { workspace_id: ws, id: id ?? crypto.randomUUID(), date, table_id, data: clone(data), created_at: created_at || nowISO(), updated_at: nowISO() };
    upsertInto(backend.local, "reservations", ["workspace_id", "id"], row);
    mirror((store) => upsertInto(store, "reservations", ["workspace_id", "id"], row));
    await fireWatches();
  },
  deleteReservationRow: async (id) => {
    const ws = requireWorkspace();
    const drop = (store) => {
      const rows = tableOf(store, "reservations");
      const keep = rows.filter((r) => !(asKey(r.id) === asKey(id) && r.workspace_id === ws));
      rows.length = 0; rows.push(...keep);
    };
    drop(backend.local);
    mirror(drop);
    await fireWatches();
  },
  writeArchiveEntry: async ({ id, date, label, state }) => {
    const ws = requireWorkspace();
    const row = { workspace_id: ws, id: id || crypto.randomUUID(), date, label, state: clone(state), created_at: nowISO(), deleted_at: null };
    upsertInto(backend.local, "service_archive", ["id"], row);
    mirror((store) => upsertInto(store, "service_archive", ["id"], row));
    await fireWatches();
    return row.id;
  },
  finishServiceLocally: async ({ archive = null, blankRows = [], expected = null }) => {
    const ws = requireWorkspace();
    // Mirror the local identity guard (see powersync/writes.js).
    if (expected && (expected.startedAt || expected.date)) {
      const row = tableOf(backend.local, "service_settings")
        .find((r) => r.workspace_id === ws && r.id === "service_date");
      const state = row?.state || null;
      const startedOk = !expected.startedAt || state?.startedAt == null
        || state.startedAt === expected.startedAt;
      const dateOk = !expected.date || state?.date === expected.date;
      if (!state?.date || !startedOk || !dateOk) return { superseded: true };
    }
    applyFinishedServiceToStore(backend.local, ws, { archive, blankRows });
    mirror((store) => applyFinishedServiceToStore(store, ws, { archive, blankRows }));
    await fireWatches();
    return { superseded: false };
  },
  setArchiveDeleted: async (id, deletedAt) => {
    const set = (store) => {
      const hit = tableOf(store, "service_archive").find((r) => asKey(r.id) === asKey(id));
      if (hit) hit.deleted_at = deletedAt;
    };
    set(backend.local); mirror(set);
    await fireWatches();
  },
  setAllArchivesDeleted: async (deletedAt) => {
    const ws = requireWorkspace();
    const set = (store) => tableOf(store, "service_archive").forEach((r) => {
      if (r.workspace_id === ws && r.deleted_at == null) r.deleted_at = deletedAt;
    });
    set(backend.local); mirror(set);
    await fireWatches();
  },
  purgeDeletedArchives: async () => {
    const purge = (store) => {
      const rows = tableOf(store, "service_archive");
      const keep = rows.filter((r) => r.deleted_at == null);
      rows.length = 0; rows.push(...keep);
    };
    purge(backend.local); mirror(purge);
    await fireWatches();
  },
  writeMenuCourses: async (changedRows, keptPositions = null) => {
    const ws = requireWorkspace();
    for (const r of changedRows) {
      const row = { workspace_id: ws, ...clone(r), updated_at: nowISO() };
      upsertInto(backend.local, "menu_courses", ["workspace_id", "position"], row);
      mirror((store) => upsertInto(store, "menu_courses", ["workspace_id", "position"], row));
    }
    if (Array.isArray(keptPositions) && keptPositions.length) {
      const prune = (store) => {
        const rows = tableOf(store, "menu_courses");
        const keep = rows.filter((r) => r.workspace_id !== ws || keptPositions.includes(Number(r.position)));
        rows.length = 0; rows.push(...keep);
      };
      prune(backend.local); mirror(prune);
    }
    await fireWatches();
  },
  writeWines: async (rows) => {
    const ws = requireWorkspace();
    for (const r of rows) {
      const row = { workspace_id: ws, ...clone(r), updated_at: nowISO() };
      upsertInto(backend.local, "wines", ["workspace_id", "key"], row);
      mirror((store) => upsertInto(store, "wines", ["workspace_id", "key"], row));
    }
    await fireWatches();
  },
  deleteWines: async (keys) => {
    if (!keys?.length) return;
    const ws = requireWorkspace();
    const drop = (store) => {
      const rows = tableOf(store, "wines");
      const keep = rows.filter((r) => r.workspace_id !== ws || !keys.map(asKey).includes(asKey(r.key)));
      rows.length = 0; rows.push(...keep);
    };
    drop(backend.local); mirror(drop);
    await fireWatches();
  },
  replaceManualBeverages: async (rows, categories = ["cocktail", "spirit", "beer"]) => {
    if (!categories?.length) return;
    const ws = requireWorkspace();
    const swap = (store) => {
      const all = tableOf(store, "beverages");
      const keep = all.filter((r) => r.workspace_id !== ws || r.source !== "manual" || !categories.includes(r.category));
      all.length = 0; all.push(...keep, ...rows.map((r) => ({ workspace_id: ws, id: crypto.randomUUID(), source: "manual", ...clone(r) })));
    };
    swap(backend.local); mirror(swap);
    await fireWatches();
  },
};

// ── fake store seams (lib/stateStore, lib/archiveStore) ──────────────────────
// vitest's mock registry intermittently resolves a dynamic import() made from
// a mocked-dependency module (stateStore/archiveStore) back to the REAL
// powersync modules when it happens mid-render — even though the same call
// from test code resolves to the fake (see the "mock sanity" test). So the
// harness mocks these two thin seams directly, with the same contract and the
// same primary-flag routing they implement for real.
import { isSqlitePrimary } from "../../powersync/primary.js";

const remoteSettingsRow = (id) =>
  tableOf(backend.remote, "service_settings").find((r) => r.workspace_id === getWorkspaceId() && asKey(r.id) === asKey(id));

export const fakeStateStore = {
  // The fake writes synchronously — nothing is ever retained for retry, so
  // dropping pending values is a no-op here.
  dropPendingStateKey: () => {},
  readStateKey: async (id) => {
    if (isSqlitePrimary()) return fakeReads.readSetting(id);
    return clone(remoteSettingsRow(id)?.state ?? null);
  },
  saveStateKey: async (id, state) => {
    if (!getWorkspaceId()) return { ok: true };
    try {
      if (isSqlitePrimary()) { await fakeWrites.writeSetting(id, state); return { ok: true }; }
      if (backend.failRemoteWrites) throw new Error("fake network: remote writes are failing");
      upsertInto(backend.remote, "service_settings", ["workspace_id", "id"],
        { workspace_id: getWorkspaceId(), id, state: clone(state), updated_at: nowISO() });
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  },
};

export const fakeArchiveStore = {
  getWorkspaceId,
  fetchArchive: async () => {
    if (isSqlitePrimary()) return fakeReads.readServiceArchive();
    const rows = tableOf(backend.remote, "service_archive").filter((r) => r.workspace_id === getWorkspaceId());
    return {
      active: clone(rows.filter((r) => r.deleted_at == null).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 60)),
      deleted: clone(rows.filter((r) => r.deleted_at != null).sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1)).slice(0, 30)),
    };
  },
  archiveSetDeleted: async (id, deletedAt) => {
    try {
      if (isSqlitePrimary()) await fakeWrites.setArchiveDeleted(id, deletedAt);
      else {
        if (backend.failRemoteWrites) throw new Error("fake network: remote writes are failing");
        const hit = tableOf(backend.remote, "service_archive").find((r) => asKey(r.id) === asKey(id));
        if (hit) hit.deleted_at = deletedAt;
      }
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  },
  archiveSetAllDeleted: async (deletedAt) => {
    try {
      if (isSqlitePrimary()) await fakeWrites.setAllArchivesDeleted(deletedAt);
      else {
        if (backend.failRemoteWrites) throw new Error("fake network: remote writes are failing");
        tableOf(backend.remote, "service_archive").forEach((r) => {
          if (r.workspace_id === getWorkspaceId() && r.deleted_at == null) r.deleted_at = deletedAt;
        });
      }
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  },
  archivePurgeTrash: async () => {
    try {
      if (isSqlitePrimary()) await fakeWrites.purgeDeletedArchives();
      else {
        if (backend.failRemoteWrites) throw new Error("fake network: remote writes are failing");
        const rows = tableOf(backend.remote, "service_archive");
        const keep = rows.filter((r) => r.deleted_at == null);
        rows.length = 0; rows.push(...keep);
      }
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  },
};

// ── fake powersync: config / system / watch ──────────────────────────────────
export const fakeConfig = {
  POWERSYNC_URL: "https://fake.powersync.test",
  isPowerSyncEnabled: (workspaceId) => backend.psMode && Boolean(workspaceId),
};

export const fakeSystem = {
  getPowerSync: () => { throw new Error("fake system: getPowerSync not modeled"); },
  connect: async (onStatus) => {
    backend.lastOnStatus = onStatus || null;
    onStatus?.({ connected: true, hasSynced: true, hasSyncedP1: true, lastSyncedAt: Date.now() });
    return async () => {};
  },
  // Contaminated-DB self-heal: wipe local, "re-sync" the current user's rows
  // (remote copy — the stream never delivers foreign workspaces), and emit a
  // fresh checkpoint status so the sqlite-primary probe re-runs.
  clearLocalAndResync: async () => {
    backend.clearResyncs += 1;
    backend.local = newStore();
    for (const [name, rows] of backend.remote.tables) tableOf(backend.local, name).push(...clone(rows));
    backend.lastOnStatus?.({ connected: true, hasSynced: true, hasSyncedP1: true, lastSyncedAt: Date.now() + backend.clearResyncs });
  },
};

export const fakeWatch = {
  startWatches: (handlers, range) => {
    backend.watch = { handlers, range };
    fireWatches(); // first fire seeds the UI, like the real triggerImmediate
    return () => { if (backend.watch?.handlers === handlers) backend.watch = null; };
  },
};
