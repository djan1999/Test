// Reservations Admin is ONE panel inside the existing admin, not a second admin
// application nested in the first. What that means concretely, and what this
// file pins: the panel draws no page padding, no width cap and no chrome of its
// own, because AdminLayout's <main> already provides all three to every sibling
// panel. Only the panel body may differ from a sibling at the same viewport.

import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import ReservationsAdminPanel from "../components/admin/reservations/ReservationsAdminPanel.jsx";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES } from "../domain/reservations/config.js";

const panelProps = (overrides = {}) => ({
  config: DEFAULT_RESERVATION_CONFIG,
  weeklyServices: DEFAULT_WEEKLY_SERVICES,
  exceptions: [],
  bookings: [],
  audit: [],
  onSave: vi.fn().mockResolvedValue({}),
  ...overrides,
});

const SECTIONS = [
  "Overview",
  "Services & Hours",
  "Calendar & Closures",
  "Availability & Capacity",
  "Tables",
  "Booking Rules",
  "Experiences",
  "Public Booking Page",
  "Guest Messages",
  "Waitlist",
  "Guests & Privacy",
  "Permissions",
  "Audit Log",
];

describe("Reservations Admin sits inside the admin content area", () => {
  it("draws its own section list and nothing above it", () => {
    const { container } = render(<ReservationsAdminPanel {...panelProps()} />);

    // Exactly one navigation region: the panel's section list. A second <nav>
    // here would be the nested sidebar this panel is not allowed to draw.
    const navs = container.querySelectorAll("nav");
    expect(navs).toHaveLength(1);
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("lists all thirteen sections", () => {
    const { container } = render(<ReservationsAdminPanel {...panelProps()} />);
    const nav = within(container.querySelector("nav"));
    for (const section of SECTIONS) {
      expect(nav.getByRole("button", { name: new RegExp(`^${section}`, "i") })).toBeInTheDocument();
    }
    expect(nav.getAllByRole("button")).toHaveLength(SECTIONS.length);
  });

  it("adds no page padding or width cap of its own — those are AdminLayout's", () => {
    const { container } = render(<ReservationsAdminPanel {...panelProps()} />);
    const root = container.firstElementChild;

    // The root may reserve space for the sticky save bar, but must not inset the
    // page: a second set of page padding is what read as a nested app frame.
    expect(root.style.padding).toBe("");
    expect(root.style.maxWidth).toBe("");

    const body = container.querySelector("nav").parentElement.lastElementChild;
    expect(body.style.padding).toBe("");
    expect(body.style.maxWidth).toBe("");
  });

  it("gives the section list no panel background of its own", () => {
    const { container } = render(<ReservationsAdminPanel {...panelProps()} />);
    expect(container.querySelector("nav").style.background).toBe("");
  });
});
