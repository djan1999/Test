import { describe, expect, it } from "vitest";
import {
  activeLegacyReservations,
  bookingToLegacyReservation,
  legacyReservationToBooking,
  tableIdToLabel,
  tableLabelToId,
} from "../bookingAdapter.js";

describe("reservation booking compatibility adapter", () => {
  it("normalizes numeric and prefixed table identities", () => {
    expect(tableLabelToId("T07")).toBe(7);
    expect(tableLabelToId(12)).toBe(12);
    expect(tableIdToLabel(7)).toBe("T07");
  });

  it("preserves the complete operational vocabulary in both directions", () => {
    const booking = {
      id: "00000000-0000-4000-8000-000000000001",
      date: "2026-07-25",
      service: "lunch",
      time: "12:30",
      pax: 4,
      status: "confirmed",
      name: "Hotel Guest",
      phone: "+38640123456",
      email: "guest@example.com",
      language: "sl",
      source: "phone",
      ref: "MK-TEST",
      tableLabel: "T03",
      experience: "seasonal",
      occasion: "birthday",
      notes: "Window",
      allergies: [{ key: "nuts", pos: 2 }],
      accessibility: ["wheelchair"],
      consentNews: true,
      operationalData: {
        menuType: "short",
        guestType: "hotel",
        rooms: ["11", "12"],
        birthday: true,
        cakeNote: "No sugar",
        tableGroup: ["T03", "T04"],
        courseOverrides: { c1: false },
        kitchenCourseNotes: { c2: "small" },
      },
    };

    const legacy = bookingToLegacyReservation(booking);
    expect(legacy.table_id).toBe(3);
    expect(legacy.data.tableGroup).toEqual([3, 4]);
    expect(legacy.data.rooms).toEqual(["11", "12"]);
    expect(legacy.data.phone).toBe("+38640123456");

    const roundTrip = legacyReservationToBooking(legacy);
    expect(roundTrip.tableLabel).toBe("T03");
    expect(roundTrip.operationalData.tableGroup).toEqual(["T03", "T04"]);
    expect(roundTrip.operationalData.kitchenCourseNotes).toEqual({ c2: "small" });
    expect(roundTrip.allergies).toEqual([{ key: "nuts", pos: 2 }]);
  });

  it("only projects active bookings into Service compatibility rows", () => {
    const base = {
      date: "2026-07-25",
      service: "dinner",
      time: "18:00",
      pax: 2,
      name: "Guest",
      tableLabel: "T01",
    };
    expect(activeLegacyReservations([
      { ...base, id: "a", status: "confirmed" },
      { ...base, id: "b", status: "cancelled" },
    ]).map((row) => row.id)).toEqual(["a"]);
  });
});
