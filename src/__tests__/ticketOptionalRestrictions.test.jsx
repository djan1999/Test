// An optional dish carries only the restrictions of the guests having it.
// A pescetarian at P2 must not put a pescetarian substitution on the cheese
// that only P1 ordered — that plate goes out as normal.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KitchenTicket } from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };
const course = (key, position, extra = {}) => ({
  position, course_key: key, menu: { name: key.toUpperCase(), sub: "" },
  is_snack: false, is_active: true, optional_flag: "", course_category: "main",
  restrictions: { pescetarian: { name: `FISH ${key.toUpperCase()}`, sub: "" } },
  ...extra,
});
const menu = [
  course("deer", 1),
  course("cheese", 2, { course_category: "optional", optional_flag: "cheese" }),
];
const table = (cheeseBy, restrictions = [{ pos: 2, note: "pescetarian" }]) => ({
  id: 1, active: true, guests: 2, tableGroup: [],
  seats: [1, 2].map(id => ({ id, ...seatDefaults, extras: cheeseBy.includes(id) ? { cheese: { ordered: true } } : {} })),
  kitchenLog: {}, kitchenAlert: null, kitchenCourseNotes: {}, menuType: "", lang: "en",
  restrictions,
});

describe("KitchenTicket — optional dish restrictions", () => {
  it("drops a restriction from an optional dish the restricted guest didn't order", () => {
    render(<KitchenTicket table={table([1])} menuCourses={menu} upd={vi.fn()} />);
    expect(screen.getByText(/1× FISH DEER/)).toBeTruthy();       // regular course: still applies
    expect(screen.queryByText(/FISH CHEESE/)).toBeNull();         // P1's cheese goes out normal
  });

  it("keeps it when the restricted guest ordered the dish", () => {
    render(<KitchenTicket table={table([1, 2])} menuCourses={menu} upd={vi.fn()} />);
    expect(screen.getByText(/1× FISH CHEESE/)).toBeTruthy();
  });

  it("keeps a restriction not yet pinned to a chair", () => {
    render(<KitchenTicket table={table([1], [{ pos: null, note: "pescetarian" }])} menuCourses={menu} upd={vi.fn()} />);
    expect(screen.getByText(/1× FISH CHEESE/)).toBeTruthy();
  });
});
