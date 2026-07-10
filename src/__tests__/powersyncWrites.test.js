import { describe, it, expect, beforeEach, vi } from "vitest";

// Fake PowerSync db that models the PRODUCTION view semantics:
//   • a real row store keyed by (table, id, workspace_id) — getOptional
//     consults it, INSERT adds to it and throws the same UNIQUE error the
//     ps_data__* primary key throws on a duplicate
//   • UPDATE always reports rowsAffected 0, exactly like SQLite does for
//     writes routed through the PowerSync views' INSTEAD OF triggers —
//     trigger-made changes are not counted. Trusting rowsAffected to pick
//     update-vs-insert is how every save of a synced row crashed in
//     production (05.07); any code that regresses to it fails these tests
//     with that same UNIQUE error.
const h = vi.hoisted(() => ({
  calls: [],
  rows: new Set(), // `${table}|${id}|${workspace_id}`
  workspaceId: "ws-1",
  transactions: 0,
}));

vi.mock("../powersync/system.js", () => {
  const key = (table, id, ws) => `${table}|${id}|${ws}`;
  const record = (sql, params) => h.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
  const execute = async (sql, params) => {
    record(sql, params);
    const table = sql.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i)?.[1];
    if (/^\s*INSERT/i.test(sql)) {
      const k = key(table, String(params[0]), params[1]);
      if (h.rows.has(k)) throw new Error(`UNIQUE constraint failed: ps_data__${table}.id`);
      h.rows.add(k);
      return { rowsAffected: 1 };
    }
    return { rowsAffected: 0 }; // view UPDATE/DELETE: trigger changes not counted
  };
  const getOptional = async (sql, params) => {
    record(sql, params);
    const table = sql.match(/FROM\s+(\w+)/i)[1];
    return h.rows.has(key(table, String(params[0]), params[1])) ? { id: String(params[0]) } : null;
  };
  const ctx = { execute, getOptional };
  return { getPowerSync: () => ({
    execute,
    getOptional,
    writeTransaction: async (fn) => { h.transactions += 1; return fn(ctx); },
  }) };
});

vi.mock("../lib/supabaseClient.js", () => ({
  getWorkspaceId: () => h.workspaceId,
  supabase: {},
}));

import {
  writeServiceTables, writeSetting, writeReservation, deleteReservationRow,
  writeMenuCourses, writeWines, deleteWines, replaceManualBeverages,
  finishServiceLocally,
} from "../powersync/writes.js";

const callsLike = (verb) => h.calls.filter((c) => c.sql.toUpperCase().startsWith(verb));

beforeEach(() => {
  h.calls = [];
  h.rows = new Set();
  h.workspaceId = "ws-1";
  h.transactions = 0;
});

describe("powersync/writes — board rows", () => {
  it("updates an existing row in place (no insert) with jsonb as text", async () => {
    h.rows.add("service_tables|ws-1|3|ws-1");
    await writeServiceTables([{ table_id: 3, data: { resName: "Kovač" }, updated_at: "t1" }]);
    const updates = callsLike("UPDATE");
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("UPDATE service_tables SET");
    expect(updates[0].params).toEqual([3, '{"resName":"Kovač"}', "t1", "ws-1|3", "ws-1"]);
    expect(callsLike("INSERT")).toHaveLength(0);
  });

  it("REGRESSION: saving a synced row repeatedly never duplicate-INSERTs even though view UPDATEs report rowsAffected 0", async () => {
    h.rows.add("service_tables|ws-1|3|ws-1");
    // The pre-fix code fell through to INSERT here and died on the ps_data__*
    // primary key — the crash that blocked all saves on sqlite-primary.
    await writeServiceTables([{ table_id: 3, data: { resName: "a" }, updated_at: "t1" }]);
    await writeServiceTables([{ table_id: 3, data: { resName: "b" }, updated_at: "t2" }]);
    expect(callsLike("INSERT")).toHaveLength(0);
    expect(callsLike("UPDATE")).toHaveLength(2);
  });

  it("falls through to INSERT with the aliased id when the row is missing", async () => {
    await writeServiceTables([{ table_id: 7, data: {}, updated_at: "t1" }]);
    const inserts = callsLike("INSERT");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("INSERT INTO service_tables (id, workspace_id, table_id, data, updated_at)");
    expect(inserts[0].params).toEqual(["ws-1|7", "ws-1", 7, "{}", "t1"]);
    // …and a second save of the now-existing row goes through UPDATE.
    await writeServiceTables([{ table_id: 7, data: { x: 1 }, updated_at: "t2" }]);
    expect(callsLike("INSERT")).toHaveLength(1);
    expect(callsLike("UPDATE")).toHaveLength(1);
  });

  it("refuses to write without an active workspace", async () => {
    h.workspaceId = null;
    await expect(writeServiceTables([{ table_id: 1, data: {} }])).rejects.toThrow(/workspace/);
    expect(h.calls).toHaveLength(0);
  });
});

describe("powersync/writes — settings", () => {
  it("stores the state blob as JSON text under the settings id", async () => {
    await writeSetting("menu_logo", { dataUri: "data:x" });
    const insert = callsLike("INSERT")[0];
    expect(insert.sql).toContain("INSERT INTO service_settings (id, workspace_id, state, updated_at)");
    expect(insert.params[0]).toBe("ws-1|menu_logo");
    expect(insert.params[2]).toBe('{"dataUri":"data:x"}');
  });

  it("REGRESSION: re-saving a synced setting updates in place (the 'Settings save failed (service_date)' crash)", async () => {
    h.rows.add("service_settings|ws-1|service_date|ws-1");
    await writeSetting("service_date", { date: "2026-07-05" });
    expect(callsLike("INSERT")).toHaveLength(0);
    expect(callsLike("UPDATE")).toHaveLength(1);
  });
});

describe("powersync/writes — reservations", () => {
  it("update path never restamps created_at", async () => {
    h.rows.add("reservations|uuid-1|ws-1");
    await writeReservation({ id: "uuid-1", date: "2026-06-06", table_id: 2, data: { resName: "Smith" } });
    const updates = callsLike("UPDATE");
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("UPDATE reservations SET date = COALESCE(?, date), table_id = COALESCE(?, table_id), data = ?");
    expect(updates[0].sql).not.toContain("created_at");
    expect(updates[0].params).toEqual(["2026-06-06", 2, '{"resName":"Smith"}', "uuid-1", "ws-1"]);
    expect(callsLike("INSERT")).toHaveLength(0);
  });

  it("REGRESSION (08.07): an edit arriving without a date keeps the stored date instead of nulling it", async () => {
    // A NULL date threw the row out of every date-scoped read (the reservation
    // 'vanished') and Postgres rejected the upload (NOT NULL). COALESCE binds
    // null and lets the stored value win.
    h.rows.add("reservations|uuid-1|ws-1");
    await writeReservation({ id: "uuid-1", table_id: undefined, data: { resName: "Smith" } });
    const update = callsLike("UPDATE")[0];
    expect(update.sql).toContain("date = COALESCE(?, date)");
    expect(update.sql).toContain("table_id = COALESCE(?, table_id)");
    expect(update.params).toEqual([null, null, '{"resName":"Smith"}', "uuid-1", "ws-1"]);
  });

  it("REGRESSION (08.07): refuses to INSERT a reservation without a date", async () => {
    await expect(writeReservation({ id: "uuid-9", table_id: 4, data: {} }))
      .rejects.toThrow(/has no date/);
    expect(callsLike("INSERT")).toHaveLength(0);
  });

  it("insert path writes created_at and the caller-minted uuid", async () => {
    await writeReservation({ id: "uuid-2", date: "2026-06-06", table_id: 5, data: {}, created_at: "c1" });
    const insert = callsLike("INSERT")[0];
    expect(insert.sql).toContain("INSERT INTO reservations");
    expect(insert.params).toEqual(["uuid-2", "ws-1", "2026-06-06", 5, "{}", "c1"]);
  });

  it("delete is scoped to the workspace", async () => {
    await deleteReservationRow("uuid-3");
    expect(h.calls[0].sql).toBe("DELETE FROM reservations WHERE id = ? AND workspace_id = ?");
    expect(h.calls[0].params).toEqual(["uuid-3", "ws-1"]);
  });
});

describe("powersync/writes — menu courses", () => {
  it("upserts the changed rows (booleans as 0/1, jsonb as text) and deletes missing positions", async () => {
    await writeMenuCourses([
      { position: 1, menu: { name: "Trout" }, is_snack: false, show_on_short: true, kitchen_note: "" },
      { position: 2, menu: null, is_snack: true, show_on_short: false, kitchen_note: "fire" },
    ], [1, 2]);
    const inserts = h.calls.filter(c => c.sql.startsWith("INSERT INTO menu_courses"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[0]).toBe("ws-1|1");
    const cols = inserts[0].sql.match(/\(([^)]+)\)/)[1].split(", ");
    const row1 = Object.fromEntries(cols.map((c, i) => [c, inserts[0].params[i]]));
    expect(row1.menu).toBe('{"name":"Trout"}');
    expect(row1.is_snack).toBe(0);
    expect(row1.show_on_short).toBe(1);
    const del = h.calls.find(c => c.sql.startsWith("DELETE FROM menu_courses"));
    expect(del.sql).toContain("position NOT IN (?,?)");
    expect(del.params).toEqual(["ws-1", 1, 2]);
  });

  it("skips the delete pass entirely when no positions were removed", async () => {
    await writeMenuCourses([{ position: 3, menu: null, kitchen_note: "" }], null);
    expect(h.calls.some(c => c.sql.startsWith("DELETE FROM menu_courses"))).toBe(false);
  });

  it("deletes every stored course when the saved menu is intentionally empty", async () => {
    await writeMenuCourses([], []);
    const del = h.calls.find(c => c.sql.startsWith("DELETE FROM menu_courses"));
    expect(del.sql).toBe("DELETE FROM menu_courses WHERE workspace_id = ?");
    expect(del.params).toEqual(["ws-1"]);
  });
});

describe("powersync/writes — wines & beverages", () => {
  it("wines upsert under the key alias; deletes are key+workspace scoped", async () => {
    await writeWines([{ key: "manual|rebula", by_glass: true, wine_name: "Rebula", producer: "X", name: "X – Rebula", vintage: "2022", region: "", country: "", source: "manual" }]);
    const insert = h.calls.find(c => c.sql.startsWith("INSERT INTO wines"));
    expect(insert.params[0]).toBe("ws-1|manual|rebula");
    const cols = insert.sql.match(/\(([^)]+)\)/)[1].split(", ");
    const row = Object.fromEntries(cols.map((c, i) => [c, insert.params[i]]));
    expect(row.by_glass).toBe(1);

    h.calls = [];
    await deleteWines(["a", "b"]);
    expect(h.calls[0].sql).toContain("DELETE FROM wines WHERE workspace_id = ? AND key IN (?,?)");
    expect(h.calls[0].params).toEqual(["ws-1", "a", "b"]);
  });

  it("manual beverages: replace-all scoped to the edited categories only, placeholder uuids on inserts", async () => {
    await replaceManualBeverages([
      { category: "cocktail", name: "Negroni", notes: "", position: 0 },
      { category: "beer", name: "Union", notes: "0.5l", position: 1 },
    ], ["cocktail", "beer"]);
    expect(h.calls[0].sql).toContain("DELETE FROM beverages");
    expect(h.calls[0].sql).toContain("source = 'manual'");
    expect(h.calls[0].sql).toContain("category IN (?,?)");
    expect(h.calls[0].params).toEqual(["ws-1", "cocktail", "beer"]); // untouched spirits survive
    const inserts = h.calls.slice(1);
    expect(inserts).toHaveLength(2);
    expect(typeof inserts[0].params[0]).toBe("string"); // placeholder uuid
    expect(inserts[0].params).toContain("Negroni");
    expect(inserts[1].params).toContain("0.5l");
  });
});

describe("powersync/writes — finish service", () => {
  it("archives, clears ten tables, and clears service_date in one local transaction", async () => {
    await finishServiceLocally({
      archive: { id: "archive-1", date: "2026-07-10", label: "10. 07. 2026 – DINNER", state: { tables: [] } },
      blankRows: Array.from({ length: 10 }, (_, i) => ({ table_id: i + 1, data: {}, updated_at: "end" })),
    });

    expect(h.transactions).toBe(1);
    expect(h.calls.some(c => c.sql.startsWith("INSERT INTO service_archive"))).toBe(true);
    expect(h.calls.filter(c => c.sql.startsWith("INSERT INTO service_tables"))).toHaveLength(10);
    const setting = h.calls.find(c => c.sql.startsWith("INSERT INTO service_settings"));
    expect(setting.params[0]).toBe("ws-1|service_date");
    expect(setting.params[2]).toBe("{}");
  });

  it("is idempotent for the same deterministic archive id", async () => {
    const payload = {
      archive: { id: "archive-1", date: "2026-07-10", label: "Dinner", state: {} },
      blankRows: [{ table_id: 1, data: {}, updated_at: "end" }],
    };
    await finishServiceLocally(payload);
    h.calls = [];
    await finishServiceLocally(payload);
    expect(h.calls.some(c => c.sql.startsWith("INSERT INTO service_archive"))).toBe(false);
    expect(h.calls.some(c => c.sql.startsWith("UPDATE service_tables"))).toBe(true);
    expect(h.calls.some(c => c.sql.startsWith("UPDATE service_settings"))).toBe(true);
  });
});
