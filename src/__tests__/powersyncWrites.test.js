import { describe, it, expect, beforeEach, vi } from "vitest";

// Fake PowerSync db: records every execute (top-level or inside a
// writeTransaction) and lets tests script UPDATE rowsAffected to steer the
// update-vs-insert upsert path.
const h = vi.hoisted(() => ({
  calls: [],
  rowsAffectedFor: () => 0,
  workspaceId: "ws-1",
}));

vi.mock("../powersync/system.js", () => {
  const execute = async (sql, params) => {
    h.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    return { rowsAffected: sql.trimStart().toUpperCase().startsWith("UPDATE") ? h.rowsAffectedFor(sql) : 1 };
  };
  return { getPowerSync: () => ({ execute, writeTransaction: async (fn) => fn({ execute }) }) };
});

vi.mock("../lib/supabaseClient.js", () => ({
  getWorkspaceId: () => h.workspaceId,
  supabase: {},
}));

import {
  writeServiceTables, writeSetting, writeReservation, deleteReservationRow,
  replaceMenuCourses, writeWines, deleteWines, replaceManualBeverages,
} from "../powersync/writes.js";

beforeEach(() => {
  h.calls = [];
  h.rowsAffectedFor = () => 0;
  h.workspaceId = "ws-1";
});

describe("powersync/writes — board rows", () => {
  it("updates an existing row in place (no insert) with jsonb as text", async () => {
    h.rowsAffectedFor = () => 1;
    await writeServiceTables([{ table_id: 3, data: { resName: "Kovač" }, updated_at: "t1" }]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].sql).toContain("UPDATE service_tables SET");
    expect(h.calls[0].params).toEqual([3, '{"resName":"Kovač"}', "t1", "3", "ws-1"]);
  });

  it("falls through to INSERT with the aliased id when the row is missing", async () => {
    await writeServiceTables([{ table_id: 7, data: {}, updated_at: "t1" }]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].sql).toContain("INSERT INTO service_tables (id, workspace_id, table_id, data, updated_at)");
    expect(h.calls[1].params).toEqual(["7", "ws-1", 7, "{}", "t1"]);
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
    const insert = h.calls[1];
    expect(insert.sql).toContain("INSERT INTO service_settings (id, workspace_id, state, updated_at)");
    expect(insert.params[0]).toBe("menu_logo");
    expect(insert.params[2]).toBe('{"dataUri":"data:x"}');
  });
});

describe("powersync/writes — reservations", () => {
  it("update path never restamps created_at", async () => {
    h.rowsAffectedFor = () => 1;
    await writeReservation({ id: "uuid-1", date: "2026-06-06", table_id: 2, data: { resName: "Smith" } });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].sql).toContain("UPDATE reservations SET date = ?, table_id = ?, data = ?");
    expect(h.calls[0].sql).not.toContain("created_at");
  });

  it("insert path writes created_at and the caller-minted uuid", async () => {
    await writeReservation({ id: "uuid-2", date: "2026-06-06", table_id: 5, data: {}, created_at: "c1" });
    const insert = h.calls[1];
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
  it("upserts every row (booleans as 0/1, jsonb as text) and deletes missing positions", async () => {
    await replaceMenuCourses([
      { position: 1, menu: { name: "Trout" }, is_snack: false, show_on_short: true, kitchen_note: "" },
      { position: 2, menu: null, is_snack: true, show_on_short: false, kitchen_note: "fire" },
    ]);
    const inserts = h.calls.filter(c => c.sql.startsWith("INSERT INTO menu_courses"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[0]).toBe("1"); // aliased id = String(position)
    const cols = inserts[0].sql.match(/\(([^)]+)\)/)[1].split(", ");
    const row1 = Object.fromEntries(cols.map((c, i) => [c, inserts[0].params[i]]));
    expect(row1.menu).toBe('{"name":"Trout"}');
    expect(row1.is_snack).toBe(0);
    expect(row1.show_on_short).toBe(1);
    const del = h.calls.find(c => c.sql.startsWith("DELETE FROM menu_courses"));
    expect(del.sql).toContain("position NOT IN (?,?)");
    expect(del.params).toEqual(["ws-1", 1, 2]);
  });
});

describe("powersync/writes — wines & beverages", () => {
  it("wines upsert under the key alias; deletes are key+workspace scoped", async () => {
    await writeWines([{ key: "manual|rebula", by_glass: true, wine_name: "Rebula", producer: "X", name: "X – Rebula", vintage: "2022", region: "", country: "", source: "manual" }]);
    const insert = h.calls.find(c => c.sql.startsWith("INSERT INTO wines"));
    expect(insert.params[0]).toBe("manual|rebula");
    const cols = insert.sql.match(/\(([^)]+)\)/)[1].split(", ");
    const row = Object.fromEntries(cols.map((c, i) => [c, insert.params[i]]));
    expect(row.by_glass).toBe(1);

    h.calls = [];
    await deleteWines(["a", "b"]);
    expect(h.calls[0].sql).toContain("DELETE FROM wines WHERE workspace_id = ? AND key IN (?,?)");
    expect(h.calls[0].params).toEqual(["ws-1", "a", "b"]);
  });

  it("manual beverages: replace-all within the edited categories, placeholder uuids on inserts", async () => {
    await replaceManualBeverages([
      { category: "cocktail", name: "Negroni", notes: "", position: 0 },
      { category: "beer", name: "Union", notes: "0.5l", position: 1 },
    ]);
    expect(h.calls[0].sql).toContain("DELETE FROM beverages");
    expect(h.calls[0].sql).toContain("source = 'manual'");
    const inserts = h.calls.slice(1);
    expect(inserts).toHaveLength(2);
    expect(typeof inserts[0].params[0]).toBe("string"); // placeholder uuid
    expect(inserts[0].params).toContain("Negroni");
    expect(inserts[1].params).toContain("0.5l");
  });
});
