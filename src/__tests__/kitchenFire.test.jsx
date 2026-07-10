// ── Kitchen fire — rapid-tap regression ───────────────────────────────────────
// Two fires in quick succession on the SAME table must both land. fire() used
// to build the new kitchenLog from the render-captured `log`, so when the
// second tap arrived before the re-render it started from the stale copy and
// silently dropped the first fire. The fix passes a functional updater to
// upd(), which App applies against the latest state.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import KitchenBoard from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const makeCourse = (position) => ({
  position,
  menu: { name: `Course ${position}`, sub: "" },
  menu_si: null, wp: null, wp_si: null, na: null, na_si: null,
  os: null, os_si: null, premium: null, premium_si: null,
  hazards: null, is_snack: false,
  course_key: `course_${position}`,
  optional_flag: "", section_gap_before: false, show_on_short: false,
  short_order: null, force_pairing_title: "", force_pairing_sub: "",
  force_pairing_title_si: "", force_pairing_sub_si: "",
  kitchen_note: "", aperitif_btn: null, restrictions: {},
});

const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };

describe("KitchenBoard — archived-ticket recovery strip", () => {
  const liveTable = (id, extra = {}) => ({
    id, active: true, guests: 2, tableGroup: [], restrictions: [],
    seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
    kitchenLog: {}, kitchenAlert: null, courseOverrides: {},
    kitchenCourseNotes: {}, menuType: "", lang: "en", resName: "", resTime: "",
    ...extra,
  });

  it("an archived-but-live ticket is recoverable from the kitchen: strip → expand → RESTORE", () => {
    // Archive used to be a one-way door from the kitchen's side — the only
    // restore lived inside the END SERVICE modal, next to CLEAR ALL.
    const upd = vi.fn();
    render(
      <KitchenBoard
        tables={[liveTable(1, { kitchenArchived: true, resName: "NOVAK" }), liveTable(2)]}
        menuCourses={[makeCourse(1)]}
        upd={upd}
        updMany={vi.fn()}
      />
    );
    // hidden from the grid, present in the collapsed strip
    fireEvent.click(screen.getByText(/ARCHIVED \(1\)/));
    expect(screen.getByText("NOVAK")).toBeTruthy();
    fireEvent.click(screen.getByText("RESTORE"));
    expect(upd).toHaveBeenCalledWith(1, "kitchenArchived", false);
  });

  it("the strip renders even when EVERY live ticket is archived (empty grid)", () => {
    render(
      <KitchenBoard
        tables={[liveTable(1, { kitchenArchived: true })]}
        menuCourses={[makeCourse(1)]}
        upd={vi.fn()}
        updMany={vi.fn()}
      />
    );
    expect(screen.getByText("No active tables")).toBeTruthy();
    expect(screen.getByText(/ARCHIVED \(1\)/)).toBeTruthy();
  });

  it("no strip when nothing is archived-but-live (a cleared table doesn't count)", () => {
    render(
      <KitchenBoard
        tables={[liveTable(1), liveTable(2, { active: false, kitchenArchived: true })]}
        menuCourses={[makeCourse(1)]}
        upd={vi.fn()}
        updMany={vi.fn()}
      />
    );
    expect(screen.queryByText(/ARCHIVED/)).toBeNull();
  });
});

describe("KitchenBoard fire — rapid taps", () => {
  it("two quick fires on the same table both land (functional updates, no stale-closure drop)", () => {
    const table = {
      id: 1, active: true, guests: 2, tableGroup: [], restrictions: [],
      seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
      kitchenLog: {}, kitchenAlert: null, courseOverrides: {},
      kitchenCourseNotes: {}, menuType: "", lang: "en", resName: "", resTime: "",
    };
    const courses = [makeCourse(1), makeCourse(2)];

    // Mimic App's upd (supports the functional form) against live state, but
    // WITHOUT re-rendering between clicks — the rapid-tap case where the
    // second tap fires before React repaints with the first one applied.
    let state = { ...table };
    const upd = vi.fn((id, field, v) => {
      state = { ...state, [field]: typeof v === "function" ? v(state[field]) : v };
    });

    render(<KitchenBoard tables={[table]} menuCourses={courses} upd={upd} updMany={vi.fn()} />);
    fireEvent.click(screen.getByText("Course 1"));
    fireEvent.click(screen.getByText("Course 2"));

    // Pre-fix: the second fire rebuilt the log from the stale render copy and
    // ate the first — only one key survived.
    const firedKeys = Object.keys(state.kitchenLog);
    expect(firedKeys).toHaveLength(2);
    firedKeys.forEach((k) => expect(state.kitchenLog[k]?.firedAt).toBeTruthy());
  });
});
