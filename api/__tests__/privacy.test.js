import { describe, expect, it } from "vitest";
import {
  normalizeGuestName,
  partyMatches,
  redactAuditValue,
  redactLegacyArchiveState,
  redactPartyData,
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
