// ── Two rows of tickets, no page scroll ───────────────────────────────────────
// The wall panel is read from across the kitchen. Tickets used to size
// themselves purely by content, so with a real menu the second row's FIRE bar
// sat just past the bottom edge and had to be scrolled to — on a screen nobody
// stands close enough to scroll. The board now measures the space under its own
// top edge and caps each ticket at half of it; the course list is the only part
// that gives way, so two rows fit by construction.
//
// jsdom does no layout, so these pin the contract rather than the pixels: what
// the board measures, what it hands the ticket, and which part of the ticket
// absorbs the difference. The pixel behaviour was verified in Chromium at
// 1280×720, 1080×1920, 720×1280 and 834×1112.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import KitchenBoard, { KitchenTicket } from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const makeCourse = (position) => ({
  position,
  menu: { name: `Course ${position}`, sub: "" },
  menu_si: null, wp: null, na: null, os: null, premium: null,
  hazards: null, is_snack: false, is_active: true,
  course_key: `c${position}`,
  optional_flag: "", course_category: "main",
  kitchen_note: "", restrictions: {},
});
const COURSES = Array.from({ length: 15 }, (_, i) => makeCourse(i + 1));

const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };
const table = (id, over = {}) => ({
  id, active: true, guests: 2, tableGroup: [], restrictions: [],
  seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
  kitchenLog: {}, kitchenAlert: null, courseOverrides: {}, kitchenCourseNotes: {},
  menuType: "", lang: "en", resName: `GUEST ${id}`, resTime: "19:00", arrivedAt: "19:05",
  ...over,
});

// The board measures from the grid's top edge down. jsdom reports 0 for every
// rect, so stand in a real one — this is the 1080×1920 portrait panel.
const stubGridTop = (top) => {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = orig.call(this);
    return this.style?.display === "grid" ? { ...r, top, toJSON: () => ({}) } : r;
  };
  return () => { Element.prototype.getBoundingClientRect = orig; };
};

const setViewport = (w, h) => {
  act(() => {
    window.innerWidth = w;
    window.innerHeight = h;
    window.dispatchEvent(new Event("resize"));
  });
};

// The board measures in an effect, so let it commit before reading the DOM.
const renderBoard = (el) => { let r; act(() => { r = render(el); }); return r; };
const courseListOf = (container) => container.querySelector("[data-course-list]");
const cardOf = (container) => courseListOf(container).parentElement;

describe("kitchen board — two rows fit the panel", () => {
  let restore = null;
  const origW = window.innerWidth, origH = window.innerHeight;
  beforeEach(() => { restore = stubGridTop(55); });
  afterEach(() => {
    restore?.();
    window.innerWidth = origW; window.innerHeight = origH;
  });

  it("caps a ticket at half the space below the board's top edge", () => {
    setViewport(1080, 1920);
    const { container } = renderBoard(
      <KitchenBoard tables={[table(1), table(2)]} menuCourses={COURSES} upd={vi.fn()} updMany={vi.fn()} />
    );
    // (1920 - 55 top - 18 gutter - 12 grid gap) / 2
    const cap = Math.floor((1920 - 55 - 18 - 12) / 2);
    expect(cardOf(container).style.maxHeight).toBe(`${cap}px`);
    // Two of them plus the grid gap have to land inside the screen.
    expect(55 + cap * 2 + 12).toBeLessThanOrEqual(1920);
  });

  it("re-measures when the panel is resized or rotated", () => {
    setViewport(1080, 1920);
    const { container } = renderBoard(
      <KitchenBoard tables={[table(1)]} menuCourses={COURSES} upd={vi.fn()} updMany={vi.fn()} />
    );
    const portrait = cardOf(container).style.maxHeight;
    setViewport(1920, 1080);
    const landscape = cardOf(container).style.maxHeight;
    expect(landscape).not.toBe(portrait);
    expect(parseInt(landscape, 10)).toBe(Math.floor((1080 - 55 - 18 - 8) / 2));
  });

  it("drops the cap on a phone, where a scrolling board is the right answer", () => {
    setViewport(390, 844);
    const { container } = renderBoard(
      <KitchenBoard tables={[table(1)]} menuCourses={COURSES} upd={vi.fn()} updMany={vi.fn()} />
    );
    expect(cardOf(container).style.maxHeight).toBe("");
  });

  it("drops the cap when half the screen is too little to be worth capping", () => {
    // A 560px-tall window: a 240px ticket would be crushed, so the board keeps
    // full-size tickets and scrolls instead.
    setViewport(1280, 560);
    const { container } = renderBoard(
      <KitchenBoard tables={[table(1)]} menuCourses={COURSES} upd={vi.fn()} updMany={vi.fn()} />
    );
    expect(cardOf(container).style.maxHeight).toBe("");
  });

  it("gives the whole difference to the course list, never to the FIRE bar", () => {
    const { container } = render(
      <KitchenTicket table={table(1)} menuCourses={COURSES} upd={vi.fn()} heightCap={420} />
    );
    const list = courseListOf(container);
    // The list is the only elastic section: it flexes and scrolls...
    expect(list.style.flex).toBe("1 1 auto");
    expect(list.style.overflowY).toBe("auto");
    // ...and it keeps a readable floor rather than collapsing to nothing.
    expect(parseInt(list.style.minHeight, 10)).toBeGreaterThan(0);
    // ...while every sibling — header, banners, FIRE bar — holds its size.
    const card = cardOf(container);
    [...card.children].filter(el => el !== list).forEach(el => {
      expect(el.style.flexShrink).toBe("0");
    });
    expect(screen.getByText("FIRE")).toBeInTheDocument();
  });

  it("keeps the fixed course-list budget where a ticket sizes itself alone", () => {
    // Reservation preview, drag overlay, phone: no cap handed down, so the
    // ticket falls back to the 208/300px list budget it always had.
    const { container } = render(
      <KitchenTicket table={table(1)} menuCourses={COURSES} upd={vi.fn()} />
    );
    const list = courseListOf(container);
    expect(list.style.maxHeight).toBe("300px");
    expect(list.style.flex).toBe("");
    expect(cardOf(container).style.maxHeight).toBe("");
  });
});
