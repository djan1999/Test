// ── Kitchen ticket — FIRE / SET / UNDO ────────────────────────────────────────
// The pass used to fire by tapping a course row: a ~12px target, and the only
// way to say "this course is set" was for service to raise it from the floor.
// The ticket now carries the three verbs as buttons weighted by use — FIRE
// biggest, SET second, UNDO smallest — over a height-capped course list that
// follows the menu down as courses fire.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { KitchenTicket } from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const makeCourse = (position, name) => ({
  position,
  menu: { name, sub: "" },
  menu_si: null, wp: null, na: null, os: null, premium: null,
  hazards: null, is_snack: false, is_active: true,
  course_key: `c${position}`,
  optional_flag: "", course_category: "main",
  kitchen_note: "", restrictions: {},
});

const COURSES = [
  makeCourse(1, "Sour Soup"),
  makeCourse(2, "Linzer Eye"),
  makeCourse(3, "Trout Belly"),
  makeCourse(4, "Chamois"),
];

const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };

const table = (over = {}) => ({
  id: 2, active: true, guests: 2, tableGroup: [], restrictions: [],
  seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
  kitchenLog: {}, kitchenAlert: null, courseOverrides: {}, kitchenCourseNotes: {},
  menuType: "", lang: "en", resName: "JOZEK", resTime: "18:00", arrivedAt: "18:05",
  courseReady: null,
  ...over,
});

const setup = (over = {}, props = {}) => {
  const upd = vi.fn();
  const view = render(
    <KitchenTicket table={table(over)} menuCourses={COURSES} upd={upd} {...props} />,
  );
  return { ...view, upd };
};

// A ticket wired to real state, so a SET → UNDO → UNDO sequence behaves the
// way it does on the pass rather than against a frozen prop.
function LiveTicket({ initial }) {
  const [t, setT] = React.useState(table(initial));
  const upd = (id, f, v) => setT(prev => ({ ...prev, [f]: typeof v === "function" ? v(prev[f]) : v }));
  return <KitchenTicket table={t} menuCourses={COURSES} upd={upd} />;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("FIRE", () => {
  it("names the course it will send and fires exactly that one", () => {
    const { upd } = setup();
    fireEvent.click(screen.getByLabelText("Fire Sour Soup"));
    const [id, field, updater] = upd.mock.calls.find(c => c[1] === "kitchenLog");
    expect(id).toBe(2);
    expect(field).toBe("kitchenLog");
    expect(Object.keys(updater({}))).toEqual(["c1"]);
  });

  it("advances to the next unfired course, in menu order", () => {
    setup({ kitchenLog: { c1: { firedAt: "18:20" } } });
    expect(screen.getByLabelText("Fire Linzer Eye")).toBeTruthy();
  });

  it("treats a course fired out of order as the table's position in the menu", () => {
    // C3 went out before C2, so the table is PAST C2 — next is C4, matching
    // getCourseProgressState, which is also what service's SET → KITCHEN acts
    // on. Catching a skipped course up is the row tap's job, not FIRE's.
    setup({ kitchenLog: { c1: { firedAt: "18:20" }, c3: { firedAt: "18:30" } } });
    expect(screen.getByLabelText("Fire Chamois")).toBeTruthy();
  });

  it("goes inert at the end of the menu", () => {
    const log = { c1: { firedAt: "18:20" }, c2: { firedAt: "18:35" }, c3: { firedAt: "18:50" }, c4: { firedAt: "19:05" } };
    setup({ kitchenLog: log });
    expect(screen.queryByLabelText(/^Fire /)).toBeNull();
  });

  it("clears service's SET signal when it fires the course that was set", () => {
    const { upd } = setup({ courseReady: { key: "c1", index: 1, name: "Sour Soup", at: "18:15" } });
    fireEvent.click(screen.getByLabelText("Fire Sour Soup"));
    expect(upd).toHaveBeenCalledWith(2, "courseReady", null);
  });
});

describe("SET", () => {
  it("raises the set signal for the next course from the kitchen side", () => {
    const { upd } = setup();
    fireEvent.click(screen.getByText("SET"));
    const call = upd.mock.calls.find(c => c[1] === "courseReady");
    expect(call[2]).toMatchObject({ key: "c1", index: 1, name: "Sour Soup" });
    expect(call[2].at).toMatch(/^\d{2}:\d{2}$/);
  });

  it("takes the signal back when the same course is already set", () => {
    const { upd } = setup({ courseReady: { key: "c1", index: 1, name: "Sour Soup", at: "18:15" } });
    expect(screen.getByText("SET ✓")).toBeTruthy();
    fireEvent.click(screen.getByText("SET ✓"));
    expect(upd).toHaveBeenCalledWith(2, "courseReady", null);
  });
});

describe("UNDO", () => {
  it("is inert until something has been fired", () => {
    setup();
    expect(screen.getByText("UNDO").disabled).toBe(true);
  });

  it("takes back the course fired most recently by the CLOCK, not by menu order", () => {
    // C3 was fired before C2 — undo must return the one that actually left the
    // pass last, which is C2.
    const { upd } = setup({ kitchenLog: { c3: { firedAt: "18:30" }, c2: { firedAt: "18:45" } } });
    fireEvent.click(screen.getByText("UNDO"));
    const [, , updater] = upd.mock.calls.find(c => c[1] === "kitchenLog");
    expect(Object.keys(updater({ c3: {}, c2: {} }))).toEqual(["c3"]);
  });

  it("survives completion — a mis-tapped last course is one tap from coming back", () => {
    const log = { c1: { firedAt: "18:20" }, c2: { firedAt: "18:35" }, c3: { firedAt: "18:50" }, c4: { firedAt: "19:05" } };
    const { upd } = setup({ kitchenLog: log });
    fireEvent.click(screen.getByText("Undo"));
    const [, , updater] = upd.mock.calls.find(c => c[1] === "kitchenLog");
    expect(Object.keys(updater(log)).sort()).toEqual(["c1", "c2", "c3"]);
  });
});

describe("UNDO takes back the last ACTION, fire or set", () => {
  it("clears a SET that was the last thing done", () => {
    render(<LiveTicket initial={{ kitchenLog: { c1: { firedAt: "18:20" } } }} />);
    fireEvent.click(screen.getByText("SET"));
    expect(screen.getByText("SET ✓")).toBeTruthy();
    expect(screen.getByLabelText("Take back SET — Linzer Eye")).toBeTruthy();

    fireEvent.click(screen.getByText("UNDO"));
    expect(screen.getByText("SET")).toBeTruthy();               // signal is gone
    expect(screen.getAllByText("18:20").length).toBeGreaterThan(0); // the fire stayed
  });

  it("falls back to the fire once the set has been taken back", () => {
    render(<LiveTicket initial={{ kitchenLog: { c1: { firedAt: "18:20" } } }} />);
    fireEvent.click(screen.getByText("SET"));
    fireEvent.click(screen.getByText("UNDO"));                  // undoes the set
    expect(screen.getByLabelText("Take back FIRE — Sour Soup")).toBeTruthy();
    fireEvent.click(screen.getByText("UNDO"));                  // undoes the fire
    expect(screen.queryByText("18:20")).toBeNull();
  });

  it("undoes the fire when firing was the last thing done", () => {
    render(<LiveTicket initial={{}} />);
    fireEvent.click(screen.getByText("SET"));                   // set C01
    fireEvent.click(screen.getByLabelText("Fire Sour Soup"));   // then fire it
    expect(screen.getByLabelText("Take back FIRE — Sour Soup")).toBeTruthy();
  });

  it("restores the SET that the undone fire consumed", () => {
    // Firing a set course clears the set. Undoing that fire has to put BOTH
    // back, or the ticket lands half-way: unfired, but no longer reading SET.
    render(<LiveTicket initial={{}} />);
    fireEvent.click(screen.getByText("SET"));
    fireEvent.click(screen.getByLabelText("Fire Sour Soup"));
    expect(screen.queryByText("SET ✓")).toBeNull();             // consumed by the fire
    fireEvent.click(screen.getByText("UNDO"));
    expect(screen.getByText("SET ✓")).toBeTruthy();             // and back again
    expect(screen.getByLabelText("Fire Sour Soup")).toBeTruthy();
  });

  it("is inert when the ticket has had nothing done to it", () => {
    setup();
    expect(screen.getByText("UNDO").disabled).toBe(true);
  });
});

describe("UNDO on a ticket this screen did not act on", () => {
  it("takes back a set raised after the last fire", () => {
    // Another screen's work, or a fresh mount: no local memory, so the
    // persisted stamps order the two.
    setup({
      kitchenLog: { c1: { firedAt: "18:20" } },
      courseReady: { key: "c2", index: 2, name: "Linzer Eye", at: "18:31" },
    });
    expect(screen.getByLabelText("Take back SET — Linzer Eye")).toBeTruthy();
  });

  it("takes back the fire when the standing set predates it", () => {
    setup({
      kitchenLog: { c1: { firedAt: "18:20" }, c2: { firedAt: "18:44" } },
      courseReady: { key: "c3", index: 3, name: "Trout Belly", at: "18:30" },
    });
    expect(screen.getByLabelText("Take back FIRE — Linzer Eye")).toBeTruthy();
  });

  it("ignores a set that has already been fired", () => {
    setup({
      kitchenLog: { c1: { firedAt: "18:20" } },
      courseReady: { key: "c1", index: 1, name: "Sour Soup", at: "18:15" },
    });
    expect(screen.getByLabelText("Take back FIRE — Sour Soup")).toBeTruthy();
  });
});

describe("weighting", () => {
  it("orders the targets FIRE > SET > UNDO", () => {
    setup();
    const flexOf = (el) => Number(el.style.flex.split(" ")[0]);
    const fire = screen.getByLabelText("Fire Sour Soup");
    const set = screen.getByText("SET");
    const undo = screen.getByText("UNDO");
    expect(flexOf(fire)).toBeGreaterThan(flexOf(set));
    expect(flexOf(set)).toBeGreaterThan(flexOf(undo));
    // The verb itself, not the button box, carries the type weight.
    const fireWord = within(fire).getByText("FIRE");
    expect(parseFloat(fireWord.style.fontSize)).toBeGreaterThan(parseFloat(set.style.fontSize));
    expect(parseFloat(set.style.fontSize)).toBeGreaterThan(parseFloat(undo.style.fontSize));
  });
});

describe("the course list", () => {
  it("caps its height and scrolls, so ticket size stops tracking menu length", () => {
    const { container } = setup();
    const list = container.querySelector("[data-course-list]");
    expect(list).toBeTruthy();
    expect(list.style.maxHeight).toBeTruthy();
    expect(list.style.overflowY).toBe("auto");
  });

  it("marks the course the pass is working on", () => {
    // Scoped to the list: the FIRE button also carries the next course's name.
    const { container } = setup({ kitchenLog: { c1: { firedAt: "18:20" } } });
    const list = container.querySelector("[data-course-list]");
    const row = within(list).getByText("Linzer Eye").closest("div[style*='border-left']");
    expect(row.style.borderLeft).toContain("solid");
    expect(row.style.background).toBeTruthy();
  });

  it("still fires a single course by tapping its row — the out-of-order path", () => {
    const { upd } = setup();
    const row = screen.getByText("Chamois").closest("div[style*='cursor']");
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10 });
    fireEvent.click(row, { clientX: 10, clientY: 10 });
    const [, , updater] = upd.mock.calls.find(c => c[1] === "kitchenLog");
    expect(Object.keys(updater({}))).toEqual(["c4"]);
  });

  it("ignores a row tap that ended a scroll of the list", () => {
    const { upd } = setup();
    const row = screen.getByText("Chamois").closest("div[style*='cursor']");
    fireEvent.pointerDown(row, { clientX: 10, clientY: 200 });
    fireEvent.click(row, { clientX: 10, clientY: 40 });   // travelled — a drag, not a tap
    expect(upd.mock.calls.filter(c => c[1] === "kitchenLog")).toHaveLength(0);
  });
});

describe("the ticket editor", () => {
  it("keeps the full menu open and shows no pass actions", () => {
    // The reservations preview is a document you read end to end, not a pass
    // surface: no height cap, and no FIRE/SET/UNDO.
    const { container } = render(
      <KitchenTicket table={table()} menuCourses={COURSES} upd={vi.fn()} editable />,
    );
    expect(container.querySelector("[data-course-list]").style.maxHeight).toBe("");
    expect(screen.queryByLabelText(/^Fire /)).toBeNull();
    expect(screen.queryByText("SET")).toBeNull();
    expect(screen.queryByText("UNDO")).toBeNull();
  });
});

describe("read-only surfaces", () => {
  it("show no action bar without a write handler", () => {
    render(<KitchenTicket table={table()} menuCourses={COURSES} />);
    expect(screen.queryByLabelText(/^Fire /)).toBeNull();
  });
});

describe("live ticket integrity", () => {
  it("keeps every course reachable in the scrolled list", () => {
    const { container } = setup({ kitchenLog: { c1: { firedAt: "18:20" }, c2: { firedAt: "18:35" } } });
    const list = container.querySelector("[data-course-list]");
    COURSES.forEach(c => expect(within(list).getByText(c.menu.name)).toBeTruthy());
  });
});
