import { describe, expect, it, vi } from "vitest";
import {
  normalizeGuestName,
  partyMatches,
  redactAuditValue,
  redactLegacyArchiveState,
  redactPartyData,
  selectAll,
  streamWorkspaceExport,
} from "../privacy.js";

describe("privacy guest erasure helpers", () => {
  it("matches exact names case-insensitively after whitespace normalization", () => {
    const target = normalizeGuestName("  Ana   Kovač ");
    expect(target).toBe("ana kovač");
    expect(partyMatches({ resName: "ANA KOVAČ" }, target)).toBe(true);
    expect(partyMatches({ resName: "Ana Kovačič" }, target)).toBe(false);
  });

  it("redacts party-linked personal and dietary fields but keeps anonymous service facts", () => {
    const result = redactPartyData({
      resName: "Ana Kovač",
      resTime: "19:30",
      guests: 4,
      room: "203",
      rooms: ["203"],
      restrictions: [{ note: "nut_free", guest: "g1" }],
      notes: "VIP",
      source: "hotel",
      reference: "abc",
      kitchenCourseNotes: { c1: "separate" },
      arrivedAt: "19:42",
    });
    expect(result).toMatchObject({
      resName: "[erased]",
      resTime: "19:30",
      guests: 4,
      room: "",
      rooms: [],
      restrictions: [],
      notes: "",
      source: "",
      reference: "",
      kitchenCourseNotes: {},
      arrivedAt: "19:42",
    });
  });

  it("redacts only matching tables inside a legacy archive", () => {
    const target = normalizeGuestName("Ana Kovač");
    const state = {
      tables: [
        { id: 1, resName: "Ana Kovač", restrictions: [{ note: "gluten_free" }] },
        { id: 2, resName: "Boris Novak", notes: "keep" },
      ],
      serviceSession: "dinner",
    };
    const result = redactLegacyArchiveState(state, target);
    expect(result.changed).toBe(true);
    expect(result.value.tables[0].resName).toBe("[erased]");
    expect(result.value.tables[0].restrictions).toEqual([]);
    expect(result.value.tables[1]).toEqual(state.tables[1]);
    expect(result.value.serviceSession).toBe("dinner");
  });

  it("finds and redacts party objects nested in audit before/after data", () => {
    const target = normalizeGuestName("Ana Kovač");
    const result = redactAuditValue({
      data: { resName: "Ana Kovač", room: "203", restrictions: [{ note: "nut_free" }] },
      metadata: { resName: "Different Guest" },
    }, target);
    expect(result.changed).toBe(true);
    expect(result.value.data).toMatchObject({ resName: "[erased]", room: "", restrictions: [] });
    expect(result.value.metadata.resName).toBe("Different Guest");
  });
});

describe("privacy export transport", () => {
  it("uses a stable keyset cursor instead of unordered OFFSET pagination", async () => {
    const calls = [];
    const pages = [
      Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 })),
      [{ id: 1001 }],
    ];
    const client = {
      from: (table) => {
        const query = {
          select: (columns) => { calls.push(["select", table, columns]); return query; },
          eq: (column, value) => { calls.push(["eq", column, value]); return query; },
          order: (column) => { calls.push(["order", column]); return query; },
          gt: (column, value) => { calls.push(["gt", column, value]); return query; },
          or: (value) => { calls.push(["or", value]); return query; },
          limit: async (value) => {
            calls.push(["limit", value]);
            return { data: pages.shift() || [], error: null };
          },
        };
        return query;
      },
    };

    const rows = await selectAll(client, "audit_log", "ws-a");

    expect(rows).toHaveLength(1001);
    expect(calls).toContainEqual(["order", "id"]);
    expect(calls).toContainEqual(["gt", "id", 1000]);
    expect(calls.some(([method]) => method === "range")).toBe(false);
  });

  it("streams a valid versioned JSON export without buffering all datasets", async () => {
    const client = {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          gt: () => query,
          or: () => query,
          limit: async () => ({ data: [], error: null }),
        };
        return query;
      },
    };
    const chunks = [];
    const headers = {};
    const res = {
      setHeader: (name, value) => { headers[name] = value; },
      status: (code) => { res.statusCode = code; return res; },
      write: (chunk) => { chunks.push(chunk); return true; },
      end: vi.fn(),
    };

    await streamWorkspaceExport(
      res,
      client,
      { id: "ws-a", name: "A", slug: "a" },
      "2026-08-04T12:00:00.000Z",
    );

    const payload = JSON.parse(chunks.join(""));
    expect(res.statusCode).toBe(200);
    expect(headers["Content-Disposition"]).toContain("a-export-2026-08-04.json");
    expect(payload).toMatchObject({
      format: "service-board-workspace-export",
      version: 1,
      workspace: { id: "ws-a" },
    });
    expect(Object.keys(payload.datasets)).toHaveLength(11); // + service_events (the logbook)
    expect(Object.keys(payload.datasets)).toContain("service_events");
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
