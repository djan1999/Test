// The composer is the screen a host uses with a guest on the telephone, so
// what is pinned here is the order of the conversation and the promise that no
// table is ever hidden from them.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import BookingComposer from "../components/reservations/workspace/BookingComposer.jsx";
import {
  DEFAULT_RESERVATION_CONFIG,
  DEFAULT_WEEKLY_SERVICES,
  normalizeReservationConfig,
} from "../domain/reservations/config.js";

const DATE = "2026-07-22"; // a Wednesday — lunch and dinner both served
const config = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG);

const blank = {
  id: null,
  date: DATE,
  table_id: null,
  data: {
    reservation_v2: true,
    booking_status: "confirmed",
    service_session: "dinner",
    resTime: "",
    guests: 2,
    resName: "",
    restrictions: [],
    tableGroup: [],
  },
};

const props = (overrides = {}) => ({
  initial: blank,
  config,
  weeklyServices: DEFAULT_WEEKLY_SERVICES,
  calendarRules: [],
  bookings: [],
  onSave: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
});

const held = {
  id: "b1",
  date: DATE,
  service: "dinner",
  time: "19:00",
  pax: 2,
  status: "confirmed",
  name: "Novak",
  tableLabel: "T01",
  operationalData: { tableGroup: ["T01"] },
};

describe("BookingComposer", () => {
  it("opens on the conversation: session, sitting, name, party size", () => {
    render(<BookingComposer {...props()} />);
    expect(screen.getByText(/new reservation/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Guest name…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dinner" })).toBeInTheDocument();
    expect(screen.getByText(/fast path/i)).toBeInTheDocument();
  });

  it("shows every table before a time is picked, each saying so", () => {
    render(<BookingComposer {...props()} />);
    expect(screen.getByRole("button", { name: /^T01/ })).toBeInTheDocument();
    expect(screen.getAllByText(/pick a time first/i).length).toBe(config.tables.length);
  });

  it("keeps an unavailable table on screen with the party holding it", () => {
    render(<BookingComposer {...props({ bookings: [held] })} />);
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));

    const table = screen.getByRole("button", { name: /^T01/ });
    expect(table).toBeInTheDocument();
    expect(within(table).getByText(/novak 19:00/i)).toBeInTheDocument();
  });

  it("lets a manager override by tapping a table that is refused", () => {
    const onSave = vi.fn();
    render(<BookingComposer {...props({ bookings: [held], onSave })} />);
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    fireEvent.click(screen.getByRole("button", { name: /^T01/ }));

    expect(screen.getByText(/selected: t01/i)).toBeInTheDocument();
  });

  it("auto-assign picks a free table for the party", () => {
    render(<BookingComposer {...props({ bookings: [held] })} />);
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    fireEvent.click(screen.getByRole("button", { name: /auto-assign best/i }));

    // T01 is taken by Novak, so the engine must not choose it.
    expect(screen.queryByText(/selected: t01$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^selected: t0[2-9]/i)).toBeInTheDocument();
  });

  it("groups restrictions the way the kitchen reads them", () => {
    render(<BookingComposer {...props()} />);
    expect(screen.getByText("Dietary")).toBeInTheDocument();
    expect(screen.getByText("Allergies & Intolerances")).toBeInTheDocument();
    expect(screen.getByText("Lifestyle & Religious")).toBeInTheDocument();
  });

  it("will not save without the three things a booking cannot exist without", () => {
    const onSave = vi.fn();
    render(<BookingComposer {...props({ onSave })} />);

    fireEvent.click(screen.getByRole("button", { name: /save booking/i }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("Guest name…"), { target: { value: "Zupan, Marko" } });
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    fireEvent.click(screen.getByRole("button", { name: /save booking/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("emits the legacy row shape the workspace already saves", () => {
    const onSave = vi.fn();
    render(<BookingComposer {...props({ onSave })} />);

    fireEvent.change(screen.getByPlaceholderText("Guest name…"), { target: { value: "Zupan, Marko" } });
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    fireEvent.click(screen.getByRole("button", { name: /gluten free/i }));
    fireEvent.click(screen.getByRole("button", { name: /auto-assign best/i }));
    fireEvent.click(screen.getByRole("button", { name: /save booking/i }));

    const row = onSave.mock.calls[0][0];
    expect(row.date).toBe(DATE);
    expect(row.data).toMatchObject({
      reservation_v2: true,
      service_session: "dinner",
      resTime: "19:00",
      resName: "Zupan, Marko",
      guests: 2,
      booking_status: "confirmed",
    });
    expect(row.data.restrictions).toEqual([{ pos: null, note: "gluten" }]);
    // A joined party holds every table; a single one still travels as a group.
    expect(row.data.tableGroup.length).toBeGreaterThan(0);
    expect(row.table_id).toBe(row.data.tableGroup[0]);
  });

  it("closes on Esc without saving", () => {
    const onCancel = vi.fn();
    render(<BookingComposer {...props({ onCancel })} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
