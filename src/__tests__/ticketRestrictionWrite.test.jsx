// ── The ticket editor's restriction write must survive the reservation path ──
//
// Reported from service: "SOMETHING WENT WRONG — d.restrictions.map is not a
// function", the whole app on the error boundary, triggered by editing
// restrictions on a reservation's ticket preview.
//
// KitchenTicket writes allergy data FUNCTIONALLY — upd(id, "restrictions",
// prev => [...]) — so a concurrent write from another device can't be
// clobbered. The reservation-side handler stored `value` verbatim, so the
// field became a function. A function has a `.length` (its arity), so the
// reservation list's `restrictions?.length > 0` guard passed and `.map` threw.
// JSON.stringify also DROPS function values, so the row that reached the
// server had the guest's restrictions missing entirely.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KitchenTicket } from "../components/kitchen/KitchenBoard.jsx";
import { resolveFieldUpdate, reservationDescriptiveFields } from "../utils/tableHelpers.js";

const table = {
  id: 4,
  resName: "NOVAK",
  menuType: "long",
  lang: "en",
  seats: [{ id: 1 }, { id: 2 }],
  restrictions: [],
  kitchenLog: {},
  kitchenCourseNotes: {},
};

const menuCourses = [
  { course_key: "squash", position: 1, menu: { name: "SQUASH", sub: "cracklings" }, restrictions: {} },
];

describe("resolveFieldUpdate", () => {
  it("runs an updater against the previous value", () => {
    expect(resolveFieldUpdate(prev => [...(prev || []), "b"], ["a"])).toEqual(["a", "b"]);
  });

  it("passes a plain value straight through", () => {
    expect(resolveFieldUpdate(["a"], ["b"])).toEqual(["a"]);
    expect(resolveFieldUpdate(null, ["b"])).toBeNull();
  });
});

describe("editing restrictions on a reservation's ticket preview", () => {
  // The reservation-side handler, in the shape App.jsx uses it.
  const makeStore = (initial) => {
    const row = { data: { ...initial } };
    return {
      row,
      upd: (_tid, field, value) => {
        row.data = { ...row.data, [field]: resolveFieldUpdate(value, row.data[field]) };
      },
    };
  };

  it("stores an ARRAY, not the updater function", () => {
    const store = makeStore({ restrictions: [] });
    render(<KitchenTicket table={table} menuCourses={menuCourses} upd={store.upd} editable />);

    fireEvent.click(screen.getByText("✏ EDIT"));
    fireEvent.click(screen.getByText(/No Pork/));
    fireEvent.click(screen.getByText("All"));

    expect(Array.isArray(store.row.data.restrictions)).toBe(true);
    expect(store.row.data.restrictions).toEqual([
      { note: "no_pork", pos: null, kitchenAdded: true },
    ]);
  });

  it("survives the JSON round-trip that reaches the server", () => {
    const store = makeStore({ restrictions: [] });
    render(<KitchenTicket table={table} menuCourses={menuCourses} upd={store.upd} editable />);

    fireEvent.click(screen.getByText("✏ EDIT"));
    fireEvent.click(screen.getByText(/Gluten Free/));
    // [0] is the editor's "assign to" button; the seat chip below repeats P1.
    fireEvent.click(screen.getAllByText("P1")[0]);

    // A function-valued field is silently dropped by JSON.stringify — the
    // allergy would never reach Supabase at all.
    const persisted = JSON.parse(JSON.stringify(store.row.data));
    expect(persisted.restrictions).toEqual([
      { note: "gluten", pos: 1, kitchenAdded: true },
    ]);
  });

  it("a non-array restrictions value can never reach the board", () => {
    const junk = reservationDescriptiveFields({ restrictions: (prev) => prev });
    expect(junk.restrictions).toEqual([]);
    expect(reservationDescriptiveFields({ restrictions: { 0: "x" } }).restrictions).toEqual([]);
    expect(reservationDescriptiveFields({ restrictions: [{ note: "veg" }] }).restrictions)
      .toEqual([{ note: "veg" }]);
  });

  it("renders a table whose restrictions field is junk instead of throwing", () => {
    const broken = { ...table, restrictions: (prev) => prev };
    expect(() =>
      render(<KitchenTicket table={broken} menuCourses={menuCourses} upd={vi.fn()} />)
    ).not.toThrow();
  });
});
