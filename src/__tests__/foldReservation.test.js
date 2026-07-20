import { describe, expect, it } from "vitest";
import { foldReservationData, foldReservationRow } from "../utils/foldReservation.js";

describe("reservation three-way fold", () => {
  it("preserves a planner rename and a concurrent terrace assignment", () => {
    const ancestor = {
      resName: "ALPHA",
      guests: 2,
      visit_state: "booked",
      terrace_table: null,
      terrace_map_id: null,
      restrictions: [],
    };
    const mine = { ...ancestor, resName: "ALPHA VIP" };
    const server = {
      ...ancestor,
      visit_state: "terrace",
      terrace_table: "KV",
      terrace_map_id: "terrace-a",
    };

    const result = foldReservationData(ancestor, mine, server);
    expect(result.conflicts).toEqual([]);
    expect(result.data.resName).toBe("ALPHA VIP");
    expect(result.data.visit_state).toBe("terrace");
    expect(result.data.terrace_table).toBe("KV");
  });

  it("merges a restriction position with a concurrent kitchen-added allergy", () => {
    const ancestor = { restrictions: [{ note: "gluten", pos: null }] };
    const mine = { restrictions: [{ note: "gluten", pos: 1 }] };
    const server = { restrictions: [
      { note: "gluten", pos: null },
      { note: "nut", pos: 2, kitchenAdded: true },
    ] };

    expect(foldReservationData(ancestor, mine, server).data.restrictions).toEqual([
      { note: "gluten", pos: 1 },
      { note: "nut", pos: 2, kitchenAdded: true },
    ]);
  });

  it("keeps the server's complete terrace transition when both devices move it differently", () => {
    const ancestor = { visit_state: "booked", terrace_table: null, terrace_map_id: null };
    const mine = { visit_state: "terrace", terrace_table: "KV", terrace_map_id: "a" };
    const server = { visit_state: "terrace", terrace_table: "MV", terrace_map_id: "a" };

    const result = foldReservationData(ancestor, mine, server);
    expect(result.conflicts).toContainEqual({ type: "terrace-flow" });
    expect(result.data.visit_state).toBe("terrace");
    expect(result.data.terrace_table).toBe("MV");
  });

  it("keeps the server table assignment when two devices move the booking differently", () => {
    const ancestor = { date: "2026-07-20", table_id: 3, data: { resName: "ALPHA" } };
    const mine = { date: "2026-07-20", table_id: 7, data: { resName: "ALPHA" } };
    const server = { date: "2026-07-20", table_id: 9, data: { resName: "ALPHA" } };

    const result = foldReservationRow(ancestor, mine, server);
    expect(result.conflicts).toContainEqual({ type: "table-assignment" });
    expect(result.row.table_id).toBe(9);
  });

  it("preserves quick kitchen notes added to different courses", () => {
    const ancestor = { kitchenCourseNotes: {} };
    const mine = { kitchenCourseNotes: { starter: "NO SALT" } };
    const server = { kitchenCourseNotes: { main: "SAUCE SIDE" } };
    expect(foldReservationData(ancestor, mine, server).data.kitchenCourseNotes).toEqual({
      starter: "NO SALT",
      main: "SAUCE SIDE",
    });
  });
});
