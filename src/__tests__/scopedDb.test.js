import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for a fake, chain-recording PostgREST builder.
const h = vi.hoisted(() => {
  const builders = [];
  const VERBS = [
    "select", "insert", "upsert", "update", "delete",
    "eq", "match", "not", "is", "in", "order", "single", "maybeSingle", "gte", "lte",
  ];
  const makeBuilder = (table) => {
    const b = { _table: table, _calls: [] };
    VERBS.forEach((m) => {
      b[m] = (...args) => {
        b._calls.push([m, ...args]);
        return b;
      };
    });
    builders.push(b);
    return b;
  };
  return {
    ws: "ws-1",
    builders,
    from: (table) => makeBuilder(table),
  };
});

vi.mock("../lib/supabaseClient.js", () => ({
  supabase: { from: (t) => h.from(t) },
  getWorkspaceId: () => h.ws,
}));

import { scopedFrom } from "../lib/scopedDb.js";

const lastBuilder = () => h.builders[h.builders.length - 1];

beforeEach(() => {
  h.builders.length = 0;
  h.ws = "ws-1";
});

describe("scopedFrom", () => {
  it("scopes selects to the current workspace and keeps chaining", () => {
    scopedFrom("wines").select("*").eq("key", "abc").single();
    const b = lastBuilder();
    expect(b._table).toBe("wines");
    expect(b._calls[0][0]).toBe("select");
    expect(b._calls[0][1]).toBe("*");
    expect(b._calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(b._calls).toContainEqual(["eq", "key", "abc"]);
    expect(b._calls[b._calls.length - 1]).toEqual(["single"]);
  });

  it("stamps workspace_id and the composite onConflict on upserts", () => {
    scopedFrom("service_settings").upsert({ id: "main", state: { a: 1 } });
    const b = lastBuilder();
    expect(b._calls[0]).toEqual([
      "upsert",
      { id: "main", state: { a: 1 }, workspace_id: "ws-1" },
      { onConflict: "workspace_id,id" },
    ]);
  });

  it("stamps every row of a batch upsert and uses the table's composite key", () => {
    scopedFrom("service_tables").upsert([{ table_id: 1, data: {} }, { table_id: 2, data: {} }]);
    const b = lastBuilder();
    const [, body, opts] = b._calls[0];
    expect(body).toEqual([
      { table_id: 1, data: {}, workspace_id: "ws-1" },
      { table_id: 2, data: {}, workspace_id: "ws-1" },
    ]);
    expect(opts).toEqual({ onConflict: "workspace_id,table_id" });
  });

  it("stamps workspace_id on inserts", () => {
    scopedFrom("reservations").insert({ date: "2026-06-07", table_id: 3, data: {} });
    const b = lastBuilder();
    expect(b._calls[0]).toEqual([
      "insert",
      { date: "2026-06-07", table_id: 3, data: {}, workspace_id: "ws-1" },
      undefined,
    ]);
  });

  it("scopes updates in both the SET payload and the filter", () => {
    scopedFrom("reservations").update({ data: { x: 1 } }).eq("id", "r1");
    const b = lastBuilder();
    expect(b._calls[0]).toEqual(["update", { data: { x: 1 }, workspace_id: "ws-1" }, undefined]);
    expect(b._calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(b._calls).toContainEqual(["eq", "id", "r1"]);
  });

  it("scopes deletes to the current workspace", () => {
    scopedFrom("wines").delete().in("key", ["a", "b"]);
    const b = lastBuilder();
    expect(b._calls[0]).toEqual(["delete", undefined]);
    expect(b._calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(b._calls).toContainEqual(["in", "key", ["a", "b"]]);
  });

  it("falls back to a caller-supplied onConflict for non-composite tables", () => {
    scopedFrom("beverages").upsert({ id: 5, name: "x" }, { onConflict: "id" });
    const b = lastBuilder();
    const [, , opts] = b._calls[0];
    expect(opts).toEqual({ onConflict: "id" });
  });
});
