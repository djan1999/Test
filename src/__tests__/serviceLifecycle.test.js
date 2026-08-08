// Service ENTITY lifecycle — the wipe-proof model's core contracts.
//
// START inserts one services row; END flips ONE row (by id) to 'ended';
// nothing anywhere blanks board rows. These pins hold the properties that
// make the 22.07 / 04.07 / 11.07 / 19.06 / 10.06 wipe class structurally
// impossible:
//   • an end can only address the service id it names — a stale device's
//     late END touches the OLD row and can never blank a newer service;
//   • ending is idempotent — double-ends and replays are no-ops;
//   • no lifecycle operation writes to service_tables at all.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [], // fake SERVER `services` rows behind the scoped builder
  tableWrites: [], // every service_tables mutation attempted (must stay EMPTY)
  sqlitePrimary: false,
  serverDown: false, // scoped SELECTs reject (device cannot reach Supabase)
  localServiceRows: [], // the on-device mirror's `services` rows (primary path)
  localServiceWrites: [], // lifecycle writes routed to the local SQLite path
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {},
  getWorkspaceId: () => "ws-1",
  TABLES: { SERVICES: "services", SERVICE_TABLES: "service_tables", SERVICE_ARCHIVE: "service_archive" },
}));
vi.mock("../powersync/primary.js", () => ({ isSqlitePrimary: () => h.sqlitePrimary }));
// Primary-path stores: the local mirror (reads) and local write path — kept
// SEPARATE from h.rows so the guard tests can model a device whose mirror is
// behind the server (the exact state the blind-start guard exists for).
vi.mock("../powersync/reads.js", () => ({
  readServices: async (limit = 120) => h.localServiceRows.slice(0, limit),
}));
vi.mock("../powersync/writes.js", () => ({
  insertServiceLocally: async (entity) => { h.localServiceWrites.push({ op: "insert", ...entity }); },
  updateServiceLocally: async (id, patch) => { h.localServiceWrites.push({ op: "update", id, ...patch }); },
}));
vi.mock("../lib/scopedDb.js", () => ({
  scopedFrom: (table) => {
    if (table === "service_tables") {
      // ANY write here is a lifecycle bug — record it so the pins can assert.
      return {
        insert: (payload) => { h.tableWrites.push(payload); return Promise.resolve({ error: null }); },
        update: (payload) => { h.tableWrites.push(payload); return { eq: () => Promise.resolve({ error: null }) }; },
        upsert: (payload) => { h.tableWrites.push(payload); return Promise.resolve({ error: null }); },
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    // services / service_archive minimal fake
    const state = { filters: [] };
    const list = () => (table === "services" ? h.rows : []);
    const matches = (r) => state.filters.every((f) => f(r));
    const b = {
      insert: (payload) => {
        if (table === "services") h.rows.push({ ...payload });
        return Promise.resolve({ error: null });
      },
      update: (payload) => ({
        eq: (col, val) => {
          list().filter((r) => String(r[col]) === String(val)).forEach((r) => Object.assign(r, payload));
          return Promise.resolve({ error: null });
        },
      }),
      select: () => b,
      eq: (col, val) => { state.filters.push((r) => String(r[col]) === String(val)); return b; },
      is: (col, val) => { state.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return b; },
      not: (col, op, val) => { state.filters.push((r) => !(val === null ? r[col] == null : r[col] === val)); return b; },
      order: () => b,
      limit: () => (h.serverDown
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ data: list().filter(matches), error: null })),
      then: (res, rej) => (h.serverDown
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ data: list().filter(matches), error: null })).then(res, rej),
    };
    return b;
  },
}));

import {
  startServiceStore, endServiceStore, resumeServiceStore, updateServiceStore, readLiveServiceStore,
  confirmJoinableLiveService,
} from "../lib/serviceLifecycle.js";
import { currentServiceFrom, sanitizeService, archiveEntryFromService, mergeArchiveEntries } from "../lib/serviceEntity.js";
import { currentServiceDay } from "../utils/serviceDay.js";

beforeEach(() => {
  h.rows.length = 0;
  h.tableWrites.length = 0;
  h.sqlitePrimary = false;
  h.serverDown = false;
  h.localServiceRows.length = 0;
  h.localServiceWrites.length = 0;
});

describe("startServiceStore", () => {
  it("INSERTS a new service entity and touches no board rows", async () => {
    const res = await startServiceStore({ date: "2026-07-23", session: "dinner", chosenOn: "2026-07-23" });
    expect(res.ok).toBe(true);
    expect(res.service.id).toBeTruthy();
    expect(res.service.status).toBe("live");
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].status).toBe("live");
    expect(h.tableWrites).toHaveLength(0); // starting clears NOTHING
  });

  it("refuses a date-less start", async () => {
    const res = await startServiceStore({ date: null });
    expect(res.ok).toBe(false);
    expect(h.rows).toHaveLength(0);
  });
});

// A start is the ONLY lifecycle write that displaces the running service (the
// single-live trigger supersedes it and every device adopts the new empty
// namespace). These pins hold the blind-start guard: a device that cannot SEE
// the live service — the freshly opened third device whose local mirror
// predates this session's first checkpoint — must JOIN it, never displace it.
describe("startServiceStore — blind-start guard (the third-device reset class)", () => {
  const TODAY = currentServiceDay();
  const liveRow = (over = {}) => ({
    id: "live-1", workspace_id: "ws-1", date: TODAY, session: "dinner",
    started_at: "2026-08-08T16:00:00Z", status: "live",
    updated_at: "2026-08-08T16:00:00Z", ...over,
  });

  it("JOINS the server's live service when this device didn't name it — no insert, nothing superseded", async () => {
    h.rows.push(liveRow());
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.ok).toBe(true);
    expect(res.joined).toBe(true);
    expect(res.persisted).toBe(false);
    expect(res.service.id).toBe("live-1");
    expect(h.rows).toHaveLength(1); // the running service was never displaced
    expect(h.tableWrites).toHaveLength(0);
  });

  it("still supersedes DELIBERATELY when the caller names the live service it replaces", async () => {
    h.rows.push(liveRow());
    const res = await startServiceStore({ date: TODAY, session: "dinner", knownLiveId: "live-1" });
    expect(res.ok).toBe(true);
    expect(res.joined).toBeUndefined();
    expect(h.rows).toHaveLength(2); // the confirmed day-switch/session-flip inserted as designed
  });

  it("does not join a stale-dated live service — an abandoned night is filed, not dropped into", async () => {
    h.rows.push(liveRow({ id: "stale", date: "2026-07-01", chosen_on: "2026-07-01", started_at: "2026-07-01T16:00:00Z" }));
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.ok).toBe(true);
    expect(res.joined).toBeUndefined();
    expect(h.rows).toHaveLength(2);
  });

  it("proceeds with the start when neither the server nor the local store is reachable (offline day-open)", async () => {
    h.serverDown = true;
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.ok).toBe(true);
    expect(res.joined).toBeUndefined();
    expect(h.rows).toHaveLength(1);
  });

  it("sqlite-primary: joins when the local mirror simply hasn't synced the live service yet", async () => {
    h.sqlitePrimary = true;
    h.rows.push(liveRow()); // the server knows the running service…
    h.localServiceRows.length = 0; // …this device's mirror does not (yet)
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.joined).toBe(true);
    expect(res.service.id).toBe("live-1");
    expect(h.rows).toHaveLength(1);
    expect(h.localServiceWrites).toHaveLength(0); // no local insert either
  });

  it("sqlite-primary: an end still uploading is NOT rejoined — the local verdict is newer", async () => {
    h.sqlitePrimary = true;
    h.rows.push(liveRow({ id: "old" })); // the server hasn't seen this device's end yet
    h.localServiceRows.push({
      ...liveRow({ id: "old" }),
      status: "ended", ended_at: "2026-08-08T22:00:00Z", end_reason: "manual",
      updated_at: "2026-08-08T22:00:00Z", // newer than the server's copy
    });
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.ok).toBe(true);
    expect(res.joined).toBeUndefined();
    expect(h.localServiceWrites).toHaveLength(1); // the next service was minted
  });

  it("sqlite-primary: a service RESUMED elsewhere is rejoined — the server verdict is newer", async () => {
    h.sqlitePrimary = true;
    h.rows.push(liveRow({ id: "old", updated_at: "2026-08-08T22:30:00Z" })); // resumed after our stale end
    h.localServiceRows.push({
      ...liveRow({ id: "old" }),
      status: "ended", ended_at: "2026-08-08T21:00:00Z",
      updated_at: "2026-08-08T22:00:00Z", // older than the server's resume
    });
    const res = await startServiceStore({ date: TODAY, session: "dinner" });
    expect(res.joined).toBe(true);
    expect(res.service.id).toBe("old");
    expect(h.localServiceWrites).toHaveLength(0);
  });
});

describe("confirmJoinableLiveService", () => {
  const TODAY = currentServiceDay();

  it("returns null when the server confirms nothing is live", async () => {
    h.rows.push({ id: "done", workspace_id: "ws-1", date: TODAY, started_at: "A", status: "ended" });
    expect(await confirmJoinableLiveService()).toBe(null);
  });

  it("throws when the server is unreachable — callers keep their local knowledge", async () => {
    h.serverDown = true;
    await expect(confirmJoinableLiveService()).rejects.toThrow();
  });
});

describe("endServiceStore — the wipe-impossibility core", () => {
  it("flips ONLY the addressed row and never writes a board row", async () => {
    h.rows.push(
      { id: "old", workspace_id: "ws-1", date: "2026-07-21", session: "dinner", started_at: "2026-07-21T15:00:00Z", status: "live" },
      { id: "new", workspace_id: "ws-1", date: "2026-07-22", session: "dinner", started_at: "2026-07-22T16:49:00Z", status: "live" },
    );
    // The stale device only knows "old" — its late END lands on "old" alone.
    const res = await endServiceStore("old", { reason: "manual", label: "21. 07. 2026 – DINNER" });
    expect(res.ok).toBe(true);
    expect(h.rows.find((r) => r.id === "old").status).toBe("ended");
    expect(h.rows.find((r) => r.id === "new").status).toBe("live"); // untouched
    expect(h.tableWrites).toHaveLength(0); // ending blanks NOTHING, ever
  });

  it("is idempotent — a replayed end changes nothing it hasn't already changed", async () => {
    h.rows.push({ id: "s1", workspace_id: "ws-1", date: "2026-07-22", session: "dinner", started_at: "T", status: "ended", end_reason: "manual" });
    const res = await endServiceStore("s1", { reason: "rollover" });
    expect(res.ok).toBe(true);
    expect(h.rows[0].status).toBe("ended");
    expect(h.tableWrites).toHaveLength(0);
  });

  it("refuses to end nothing", async () => {
    const res = await endServiceStore(null);
    expect(res.ok).toBe(false);
  });
});

describe("resumeServiceStore — un-ending is one status flip", () => {
  it("flips the addressed ended row back to live and clears its end fields", async () => {
    h.rows.push({
      id: "s1", workspace_id: "ws-1", date: "2026-07-23", session: "dinner",
      started_at: "2026-07-23T16:00:00Z", status: "ended",
      ended_at: "2026-07-23T18:50:00Z", end_reason: "manual", label: "23. 07. 2026 – DINNER",
    });
    const res = await resumeServiceStore("s1");
    expect(res.ok).toBe(true);
    expect(res.resumed).toBe(true);
    expect(res.live?.id).toBe("s1");
    const row = h.rows[0];
    expect(row.status).toBe("live");
    expect(row.ended_at).toBe(null);
    expect(row.end_reason).toBe(null);
    expect(row.label).toBe(null); // re-ending mints a fresh label
    expect(h.tableWrites).toHaveLength(0); // the board rows were never gone
  });

  it("reports resumed:false when a newer live service wins the arbitration", async () => {
    h.rows.push(
      { id: "old", workspace_id: "ws-1", date: "2026-07-23", session: "lunch", started_at: "2026-07-23T10:00:00Z", status: "ended", ended_at: "E" },
      { id: "new", workspace_id: "ws-1", date: "2026-07-23", session: "dinner", started_at: "2026-07-23T16:00:00Z", status: "live" },
    );
    // The store trigger would re-end "old" as 'superseded'; even before that
    // echo lands, the honest verdict read picks the newest live row — so the
    // caller learns the resume did NOT displace the running service.
    const res = await resumeServiceStore("old");
    expect(res.ok).toBe(true);
    expect(res.resumed).toBe(false);
    expect(res.live?.id).toBe("new");
    expect(h.rows.find((r) => r.id === "new").status).toBe("live"); // untouched
    expect(h.tableWrites).toHaveLength(0);
  });

  it("refuses to resume nothing", async () => {
    const res = await resumeServiceStore(null);
    expect(res.ok).toBe(false);
    expect(h.rows).toHaveLength(0);
  });
});

describe("updateServiceStore (re-date heal / session relabel)", () => {
  it("patches one row by id", async () => {
    h.rows.push({ id: "s1", workspace_id: "ws-1", date: "2026-07-21", session: "lunch", started_at: "T", status: "live" });
    const res = await updateServiceStore("s1", { date: "2026-07-22", chosen_on: "2026-07-22" });
    expect(res.ok).toBe(true);
    expect(h.rows[0].date).toBe("2026-07-22");
    expect(h.rows[0].status).toBe("live"); // a heal never ends anything
    expect(h.tableWrites).toHaveLength(0);
  });
});

describe("currentServiceFrom — deterministic adoption", () => {
  it("picks the newest live service on every device", () => {
    const rows = [
      { id: "a", date: "2026-07-22", session: "lunch", started_at: "2026-07-22T09:00:00Z", status: "ended" },
      { id: "b", date: "2026-07-22", session: "dinner", started_at: "2026-07-22T16:00:00Z", status: "live" },
      { id: "c", date: "2026-07-22", session: "dinner", started_at: "2026-07-22T16:49:00Z", status: "live" },
    ];
    expect(currentServiceFrom(rows)?.id).toBe("c");
    expect(currentServiceFrom([...rows].reverse())?.id).toBe("c"); // order-independent
  });

  it("returns null when nothing is live (a stale echo cannot resurrect an ended service)", () => {
    expect(currentServiceFrom([
      { id: "a", date: "2026-07-22", started_at: "T", status: "ended" },
    ])).toBe(null);
    expect(currentServiceFrom([])).toBe(null);
  });
});

describe("readLiveServiceStore", () => {
  it("reads the live entity through the fallback store", async () => {
    h.rows.push(
      { id: "done", workspace_id: "ws-1", date: "2026-07-21", session: "dinner", started_at: "A", status: "ended" },
      { id: "live", workspace_id: "ws-1", date: "2026-07-22", session: "dinner", started_at: "B", status: "live" },
    );
    const live = await readLiveServiceStore();
    expect(live?.id).toBe("live");
  });
});

describe("archiveEntryFromService — the ended service IS the archive", () => {
  it("presents the service + its rows in the legacy entry shape", () => {
    const svc = sanitizeService({
      id: "s1", workspace_id: "ws-1", date: "2026-07-22", session: "dinner",
      started_at: "2026-07-22T16:49:00Z", status: "ended",
      ended_at: "2026-07-22T23:00:00Z", end_reason: "manual", label: "22. 07. 2026 – DINNER",
      snapshot: { menuCourses: [{ id: 1 }], cocktails: ["Negroni"] },
    });
    const entry = archiveEntryFromService(svc, [
      { service_id: "s1", table_id: 2, data: { resName: "Anna", active: true }, updated_at: "U" },
      { service_id: "s1", table_id: 1, data: { notes: "prep" }, updated_at: "U" },
    ]);
    expect(entry._kind).toBe("service");
    expect(entry.label).toBe("22. 07. 2026 – DINNER");
    expect(entry.created_at).toBe("2026-07-22T23:00:00Z");
    expect(entry.state.tables.map((t) => t.id)).toEqual([1, 2]); // sorted; a table note counts
    expect(entry.state.serviceSession).toBe("dinner");
    expect(entry.state.menuCourses).toEqual([{ id: 1 }]);
  });

  // A row's existence is not evidence the table was used: unseating a party,
  // or moving it elsewhere, leaves the row behind carrying nothing but its
  // default `guests` scaffold. Those rendered as nameless "2 guests" cards in
  // the archive and their phantom pax inflated the night's totals.
  it("drops board rows the night never recorded anything for", () => {
    const svc = sanitizeService({
      id: "s2", workspace_id: "ws-1", date: "2026-07-24", session: "dinner",
      started_at: "2026-07-24T16:00:00Z", status: "ended", ended_at: "2026-07-24T23:00:00Z",
    });
    const blank = { active: false, guests: 2, resName: "", resTime: "", arrivedAt: null,
      seats: [{ id: 1, water: "—", pairing: "" }, { id: 2, water: "—", pairing: "" }],
      kitchenLog: {}, restrictions: [], bottleWines: [], notes: "" };
    const entry = archiveEntryFromService(svc, [
      { service_id: "s2", table_id: 8, data: blank, updated_at: "U" },
      { service_id: "s2", table_id: 9, data: { ...blank, active: true, arrivedAt: "19:04", resName: "Elham", guests: 2 }, updated_at: "U" },
      { service_id: "s2", table_id: 10, data: blank, updated_at: "U" },
    ]);
    expect(entry.state.tables.map((t) => t.id)).toEqual([9]);
    expect(entry.state.tables.reduce((a, t) => a + (t.guests || 0), 0)).toBe(2); // not 6
  });

  it("keeps a no-show booking and a table carrying only restrictions", () => {
    const svc = sanitizeService({
      id: "s3", workspace_id: "ws-1", date: "2026-07-24", session: "dinner",
      started_at: "2026-07-24T16:00:00Z", status: "ended", ended_at: "2026-07-24T23:00:00Z",
    });
    const entry = archiveEntryFromService(svc, [
      { service_id: "s3", table_id: 3, data: { resName: "Ghost", resTime: "19:00", guests: 2, active: false }, updated_at: "U" },
      { service_id: "s3", table_id: 5, data: { restrictions: [{ note: "gluten-free", pos: 1 }], guests: 2 }, updated_at: "U" },
      { service_id: "s3", table_id: 6, data: { guests: 2 }, updated_at: "U" },
    ]);
    expect(entry.state.tables.map((t) => t.id)).toEqual([3, 5]); // T6 is a blank row
  });

  it("never drops a group member — a blank primary would vanish the whole party", () => {
    // mergeTableGroups keys each group off its lowest-id member; if that row
    // were filtered out, the surviving members are skipped as "secondaries"
    // and the party disappears from every archive surface.
    const svc = sanitizeService({
      id: "s4", workspace_id: "ws-1", date: "2026-07-24", session: "dinner",
      started_at: "2026-07-24T16:00:00Z", status: "ended", ended_at: "2026-07-24T23:00:00Z",
    });
    const entry = archiveEntryFromService(svc, [
      { service_id: "s4", table_id: 2, data: { guests: 4, active: false, tableGroup: [2, 3], seats: [] }, updated_at: "U" },
      { service_id: "s4", table_id: 3, data: { guests: 4, active: true, arrivedAt: "19:00", tableGroup: [2, 3], seats: [] }, updated_at: "U" },
    ]);
    expect(entry.state.tables.map((t) => t.id)).toEqual([2, 3]);
  });
});

describe("mergeArchiveEntries — legacy snapshots", () => {
  it("drops the untouched board rows a whole-board snapshot copied along", () => {
    const { active } = mergeArchiveEntries({
      legacyActive: [{
        id: "a1", date: "2026-07-01", label: "01. 07. 2026 – DINNER", created_at: "2026-07-01T23:00:00Z",
        state: {
          menuCourses: [],
          tables: [
            { id: 1, guests: 2, active: false, seats: [] },
            { id: 2, guests: 3, active: true, arrivedAt: "19:10", resName: "Real", seats: [] },
            { id: 3, guests: 2, active: false, seats: [] },
          ],
        },
      }],
    });
    expect(active[0].state.tables.map((t) => t.id)).toEqual([2]);
    expect(active[0]._kind).toBe("legacy");
    expect(active[0].label).toBe("01. 07. 2026 – DINNER"); // the rest of the row is untouched
  });
});
