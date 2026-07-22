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
  rows: [], // fake `services` rows behind the scoped builder
  tableWrites: [], // every service_tables mutation attempted (must stay EMPTY)
  sqlitePrimary: false,
}));

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: {},
  getWorkspaceId: () => "ws-1",
  TABLES: { SERVICES: "services", SERVICE_TABLES: "service_tables", SERVICE_ARCHIVE: "service_archive" },
}));
vi.mock("../powersync/primary.js", () => ({ isSqlitePrimary: () => h.sqlitePrimary }));
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
      limit: () => Promise.resolve({ data: list().filter(matches), error: null }),
      then: (res, rej) => Promise.resolve({ data: list().filter(matches), error: null }).then(res, rej),
    };
    return b;
  },
}));

import {
  startServiceStore, endServiceStore, updateServiceStore, readLiveServiceStore,
} from "../lib/serviceLifecycle.js";
import { currentServiceFrom, sanitizeService, archiveEntryFromService } from "../lib/serviceEntity.js";

beforeEach(() => {
  h.rows.length = 0;
  h.tableWrites.length = 0;
  h.sqlitePrimary = false;
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
    expect(entry.state.tables.map((t) => t.id)).toEqual([1, 2]); // sorted, ALL rows kept
    expect(entry.state.serviceSession).toBe("dinner");
    expect(entry.state.menuCourses).toEqual([{ id: 1 }]);
  });
});
