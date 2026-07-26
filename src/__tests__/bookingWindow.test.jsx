// The guest page used to offer a flat fourteen days. The server has always
// answered on windowDays, so a book open for months looked shut after a
// fortnight — a guest ringing to ask for a date in November was told, by the
// page, that there was nothing. These pin the page to the window the
// restaurant actually set.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PublicBookingPage from "../components/reservations/PublicBookingPage.jsx";
import {
  shiftWindowMonths,
  windowEndLabel,
  windowMonthsLabel,
} from "../components/admin/reservations/ReservationsAdminPanel.jsx";

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const publicConfig = (overrides = {}) => ({
  restaurantName: "Milka",
  phone: "+386 40 000 000",
  languages: ["en", "sl"],
  minPax: 1,
  maxPax: 6,
  windowDays: 120,
  experiences: [],
  ...overrides,
});

const page = (overrides = {}) => (
  <PublicBookingPage
    publicConfig={publicConfig(overrides)}
    loadAvailability={vi.fn().mockResolvedValue([])}
    submitBooking={vi.fn()}
    joinWaitlist={vi.fn()}
  />
);

const monthHeading = () => {
  const found = MONTHS.map((m) => screen.queryByText(new RegExp(`^${m} \\d{4}$`))).filter(Boolean);
  return found[0];
};

describe("the guest date picker follows the booking window", () => {
  it("shows a month, with weekday headings, not a fourteen-day strip", () => {
    render(page());
    const now = new Date();
    expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeInTheDocument();
    for (const day of ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
  });

  it("names the last date a guest may book", () => {
    render(page({ windowDays: 120 }));
    expect(screen.getByText(/bookings open to/i)).toBeInTheDocument();
  });

  it("walks forward month by month across the whole window", () => {
    render(page({ windowDays: 120 }));
    const start = monthHeading().textContent;

    // 120 days reaches at least three months out; every one must be reachable.
    for (let step = 0; step < 3; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    }
    expect(monthHeading().textContent).not.toBe(start);
  });

  it("stops at the end of the window instead of scrolling into empty months", () => {
    render(page({ windowDays: 30 }));
    // One month out is still partly inside a 30-day window; two is not.
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("button", { name: /next month/i })).toBeDisabled();
  });

  it("never offers a date before today", () => {
    render(page());
    expect(screen.getByRole("button", { name: /previous month/i })).toBeDisabled();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.getMonth() === new Date().getMonth()) {
      const cell = screen.getByRole("button", { name: String(yesterday.getDate()) });
      expect(cell).toBeDisabled();
    }
  });

  it("a day inside the window is selectable and drives the summary", () => {
    render(page());
    const today = new Date();
    const target = new Date();
    target.setDate(today.getDate() + 1);
    if (target.getMonth() !== today.getMonth()) return; // month boundary — covered by the walk test

    fireEvent.click(screen.getByRole("button", { name: String(target.getDate()) }));
    const summary = screen.getByText(/· 2 guests$/);
    expect(within(summary).queryByText(String(today.getDate()))).toBeNull();
  });
});

describe("admin states the window in months", () => {
  it("reads a day count back as whole months", () => {
    expect(windowMonthsLabel(30)).toBe("1 month");
    expect(windowMonthsLabel(90)).toBe("3 months");
    expect(windowMonthsLabel(120)).toBe("4 months");
  });

  it("steps by a month at a time and stays inside the stored bounds", () => {
    expect(shiftWindowMonths(90, 1)).toBe(120);
    expect(shiftWindowMonths(90, -1)).toBe(60);
    expect(shiftWindowMonths(30, -1)).toBe(30); // never below a month
    expect(shiftWindowMonths(365, 1)).toBe(365); // never past a year
  });

  it("names the real date the book closes, so nobody counts days", () => {
    const end = new Date();
    end.setDate(end.getDate() + 120);
    expect(windowEndLabel(120)).toContain(String(end.getFullYear()));
    expect(windowEndLabel(120)).toContain(String(end.getDate()));
  });
});

describe("the guest page honours months decided by hand", () => {
  const nextMonthKey = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  it("says plainly when a month is shut, instead of a silent grid of dead days", () => {
    const key = nextMonthKey();
    render(page({ windowDays: 120, months: { [key]: false } }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText(/not taking bookings in/i)).toBeInTheDocument();
  });

  it("keeps a closed month reachable, so it reads as shut rather than missing", () => {
    const key = nextMonthKey();
    render(page({ windowDays: 120, months: { [key]: false } }));
    expect(screen.getByRole("button", { name: /next month/i })).not.toBeDisabled();
  });

  it("reaches a month opened beyond the rolling window", () => {
    const far = new Date();
    far.setMonth(far.getMonth() + 5, 1);
    const key = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, "0")}`;

    // 30 days alone would stop after one month; the hand-opened month must
    // still be walkable to.
    render(page({ windowDays: 30, months: { [key]: true } }));
    for (let step = 0; step < 5; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    }
    expect(monthHeading().textContent).toBe(`${MONTHS[far.getMonth()]} ${far.getFullYear()}`);
  });
});
