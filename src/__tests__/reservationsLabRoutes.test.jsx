// The standalone LAB routes must mount the same surfaces the in-app modes do.
// /reservations previously rendered a second, older staff workspace, which is
// how the LAB and the app came to disagree about what a booking looks like.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES } from "../domain/reservations/config.js";

const loadStaffState = vi.fn();
const loadPublicConfig = vi.fn();
const loadPublicAvailability = vi.fn();

vi.mock("../reservations-lab/reservationClient.js", () => ({
  loadStaffState: (...args) => loadStaffState(...args),
  staffAction: vi.fn().mockResolvedValue({ ok: true }),
  loadPublicConfig: (...args) => loadPublicConfig(...args),
  loadPublicAvailability: (...args) => loadPublicAvailability(...args),
  submitPublicBooking: vi.fn(),
  validatePublicBooking: vi.fn(),
  submitPublicWaitlist: vi.fn(),
  loadManagedBooking: vi.fn(),
  cancelManagedBooking: vi.fn(),
  changeManagedBooking: vi.fn(),
  getLabAccessCode: () => "LAB-CODE",
  setLabAccessCode: vi.fn(),
  recordServiceVisits: vi.fn(),
  seedReservationLab: vi.fn(),
}));

const { default: ReservationsLabApp } = await import("../reservations-lab/ReservationsLabApp.jsx");

const staffState = {
  state: {
    config: DEFAULT_RESERVATION_CONFIG,
    services: DEFAULT_WEEKLY_SERVICES,
    exceptions: [],
    bookings: [{
      id: "b1",
      date: "2026-07-22",
      service: "dinner",
      time: "18:00",
      pax: 2,
      status: "confirmed",
      name: "Zupan, Marko",
      tableLabel: "T01",
      allergies: [],
      accessibility: [],
      operationalData: { tableGroup: ["T01"] },
    }],
    waitlist: [],
    guests: [],
    events: [],
    audit: [],
  },
};

beforeEach(() => {
  loadStaffState.mockReset();
  loadPublicConfig.mockReset();
  loadPublicAvailability.mockReset();
});

describe("/reservations", () => {
  it("mounts ReservationWorkspace with its six tabs, not the old staff workspace", async () => {
    loadStaffState.mockResolvedValue(staffState);
    render(<ReservationsLabApp routePath="/reservations" />);

    for (const tab of ["Day Book", "Timeline", "Calendar", "Guests", "Waitlist", "Planning & Print"]) {
      expect(await screen.findByRole("button", { name: tab })).toBeInTheDocument();
    }
  });

  it("opens the LAB with the access code, not a Milka session", async () => {
    loadStaffState.mockResolvedValue(staffState);
    render(<ReservationsLabApp routePath="/reservations" />);

    await waitFor(() => expect(loadStaffState).toHaveBeenCalled());
    expect(loadStaffState).toHaveBeenCalledWith("LAB-CODE");
  });

  it("keeps the LAB ribbon around the workspace", async () => {
    loadStaffState.mockResolvedValue(staffState);
    render(<ReservationsLabApp routePath="/reservations" />);

    expect(await screen.findByText(/isolated reservations lab/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("sends a refused access code back to the gate with wording a host can act on", async () => {
    const refused = Object.assign(new Error("staff_access_required"), { status: 401 });
    loadStaffState.mockRejectedValue(refused);
    render(<ReservationsLabApp routePath="/reservations" />);

    expect(await screen.findByText("That LAB access code is not correct.")).toBeInTheDocument();
  });
});

describe("/book", () => {
  it("mounts PublicBookingPage, not the superseded lab booking page", async () => {
    loadPublicConfig.mockResolvedValue({
      config: {
        restaurantName: "Milka",
        phone: "+386 40 000 000",
        languages: ["en", "sl"],
        online: { maxPax: 6, minPax: 1, windowDays: 90 },
        experiences: [],
      },
    });
    loadPublicAvailability.mockResolvedValue({ services: [] });
    render(<ReservationsLabApp routePath="/book" />);

    // The one-question-per-screen flow opens on party size and day.
    expect(await screen.findByText("Reserve a table")).toBeInTheDocument();
  });
});
