import { describe, expect, it } from "vitest";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES } from "../domain/reservations/config.js";
import { evaluateAvailability, resolveServicesForDate } from "../domain/reservations/availability.js";
import { assertReservationTransition, canTransitionReservation } from "../domain/reservations/lifecycle.js";

describe("reservation lifecycle", () => {
  it("enforces legal transitions and destructive reasons", () => {
    expect(canTransitionReservation("pending", "confirmed")).toBe(true);
    expect(canTransitionReservation("completed", "confirmed")).toBe(false);
    expect(() => assertReservationTransition("confirmed", "cancelled", "")).toThrow(/reason/i);
    expect(assertReservationTransition("confirmed", "cancelled", "Guest called")).toBe(true);
  });
});

describe("weekly service schedules", () => {
  it("offers lunch only on configured weekdays", () => {
    const friday = resolveServicesForDate("2026-07-24", DEFAULT_WEEKLY_SERVICES);
    const saturday = resolveServicesForDate("2026-07-25", DEFAULT_WEEKLY_SERVICES);
    expect(friday.map((service) => service.service)).toContain("lunch");
    expect(saturday.map((service) => service.service)).not.toContain("lunch");
  });

  it("allows a date exception to add or remove one service", () => {
    const added = resolveServicesForDate("2026-07-25", DEFAULT_WEEKLY_SERVICES, [
      { date: "2026-07-25", kind: "service_override", service: "lunch", mode: "on", first: "12:30", last: "13:30" },
    ]);
    const removed = resolveServicesForDate("2026-07-24", DEFAULT_WEEKLY_SERVICES, [
      { date: "2026-07-24", kind: "service_override", service: "lunch", mode: "off" },
    ]);
    expect(added.find((service) => service.service === "lunch")?.first).toBe("12:30");
    expect(removed.map((service) => service.service)).not.toContain("lunch");
  });

  it("uses the same capacity rules for every surface", () => {
    const result = evaluateAvailability({
      date: "2026-07-24",
      pax: 4,
      services: DEFAULT_WEEKLY_SERVICES,
      config: { ...DEFAULT_RESERVATION_CONFIG, pacing: { coversPerSlot: 4, coversPerService: 44 } },
      bookings: [{
        id: "existing",
        date: "2026-07-24",
        service: "dinner",
        time: "18:00",
        pax: 2,
        status: "confirmed",
        tableLabel: "T01",
      }],
    });
    expect(result.find((service) => service.service === "dinner").slots.find((slot) => slot.time === "18:00").ok).toBe(false);
  });
});
