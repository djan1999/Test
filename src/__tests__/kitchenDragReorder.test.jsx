// ── Dragging tickets around the board ─────────────────────────────────────────
// Reordering was unreliable on the touchscreen panel, and worst exactly where
// the expediter needed it: moving an unseated banner up among the seated
// tickets. Two causes, both fixed in KitchenBoard:
//
//  1. PointerSensor beat TouchSensor to every touch (200ms vs 250ms) and cannot
//     stop the browser scrolling — it can only ask, with `touch-action: none`,
//     which the cards deliberately don't set. So a drag that moved ACROSS rows
//     was claimed by the browser as a scroll and cancelled mid-air. Sideways
//     drags worked, vertical ones didn't: "sometimes".
//  2. A lifted ticket was swapped for a 120px ghost, so its slot collapsed and
//     the grid reflowed under the finger as the drag began.
//
// The sensor half can only be proven with real touch input and real layout, so
// it was verified in Chromium (drag scenarios on a 1280×720 panel: banner →
// ticket went from impossible to reliable, and a 6px finger drift during the
// press no longer cancels the grab). What jsdom CAN hold is the second half —
// that lifting a ticket leaves its slot exactly as it was.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableTicket, SortableBanner } from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const makeCourse = (position) => ({
  position, menu: { name: `Course ${position}`, sub: "" },
  menu_si: null, wp: null, na: null, os: null, premium: null,
  hazards: null, is_snack: false, is_active: true,
  course_key: `c${position}`, optional_flag: "", course_category: "main",
  kitchen_note: "", restrictions: {},
});
const COURSES = [makeCourse(1), makeCourse(2), makeCourse(3)];
const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };

const seatedTable = {
  id: 3, active: true, guests: 2, tableGroup: [], restrictions: [],
  seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
  kitchenLog: {}, kitchenAlert: null, courseOverrides: {}, kitchenCourseNotes: {},
  menuType: "", lang: "en", resName: "NOVAK", resTime: "19:00", arrivedAt: "19:05",
};
const upcomingTable = { ...seatedTable, id: 9, active: false, seats: [], resName: "KOVAC", resTime: "20:00" };

const inGrid = (children, ids) => render(
  <DndContext><SortableContext items={ids}>{children}</SortableContext></DndContext>
);

describe("kitchen board — a lifted card leaves its slot alone", () => {
  it("keeps the ticket mounted and merely invisible while it is being dragged", () => {
    const { container } = inGrid(
      <SortableTicket table={seatedTable} menuCourses={COURSES} upd={vi.fn()} isDragging anyDragging />,
      [seatedTable.id]
    );
    // Still in the DOM — that is what holds the slot's height open, so nothing
    // below the lifted ticket moves while the chef is reaching for a target.
    const list = container.querySelector("[data-course-list]");
    expect(list).toBeTruthy();
    expect(list.textContent).toContain("Course 1");
    // ...but not visible, and the hole is marked.
    expect(list.closest("div[style*='visibility']").style.visibility).toBe("hidden");
    expect(container.firstChild.style.outline).toContain("dashed");
  });

  it("marks the hole with an outline, which costs the slot no height", () => {
    // A border would add 4px to the slot the moment the card was lifted —
    // enough to nudge every row below it.
    const { container } = inGrid(
      <SortableTicket table={seatedTable} menuCourses={COURSES} upd={vi.fn()} isDragging anyDragging />,
      [seatedTable.id]
    );
    expect(container.firstChild.style.border).toBe("");
    expect(container.firstChild.style.outlineOffset).toBe("-2px");
  });

  it("does the same for an upcoming banner", () => {
    const { container } = inGrid(
      <SortableBanner table={upcomingTable} isDragging anyDragging />,
      [upcomingTable.id]
    );
    expect(screen.getByText(/KOVAC/)).toBeInTheDocument();
    const inner = container.firstChild.firstChild;
    expect(inner.style.visibility).toBe("hidden");
    expect(container.firstChild.style.outline).toContain("dashed");
  });

  it("shows the card normally when nothing is being dragged", () => {
    const { container } = inGrid(
      <SortableTicket table={seatedTable} menuCourses={COURSES} upd={vi.fn()} />,
      [seatedTable.id]
    );
    expect(container.firstChild.style.outline).toBe("");
    const list = container.querySelector("[data-course-list]");
    expect(list.closest("div[style*='visibility']")).toBeNull();
  });
});
