// ── Per-ticket restriction-text overrides ─────────────────────────────────────
// Pressing a dietary chip auto-applies the admin-configured substitution text
// (veg on "Danube" → "CHARRED CUCUMBER") to the kitchen ticket. The ticket
// editor lets staff rewrite that text for ONE reservation — extend it, replace
// it — saved into kitchenCourseNotes[courseKey].modOverrides alongside the
// existing rename/note edits. The admin course config is never touched: other
// tables keep the default, and clearing the input brings the default back.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { KitchenTicket } from "../components/kitchen/KitchenBoard.jsx";
import { generateKitchenTicketsHTML } from "../utils/weeklyPrintGenerator.js";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const seatDefaults = { water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] };

// "Danube" whose veg variant substitutes "CHARRED CUCUMBER".
const danube = {
  position: 1,
  course_key: "danube",
  menu: { name: "DANUBE", sub: "" },
  menu_si: null, wp: null, wp_si: null, na: null, na_si: null,
  os: null, os_si: null, premium: null, premium_si: null,
  hazards: null, is_snack: false,
  optional_flag: "", section_gap_before: false, show_on_short: false,
  short_order: null, force_pairing_title: "", force_pairing_sub: "",
  force_pairing_title_si: "", force_pairing_sub_si: "",
  kitchen_note: "", aperitif_btn: null,
  restrictions: { veg: { name: "CHARRED CUCUMBER", sub: "" } },
};

const makeTable = (extra = {}) => ({
  id: 1, active: true, guests: 2, tableGroup: [],
  seats: [{ id: 1, ...seatDefaults }, { id: 2, ...seatDefaults }],
  kitchenLog: {}, kitchenAlert: null, courseOverrides: {},
  kitchenCourseNotes: {}, menuType: "", lang: "en", resName: "", resTime: "",
  restrictions: [{ pos: null, note: "veg" }],
  ...extra,
});

describe("KitchenTicket — per-ticket restriction text override", () => {
  it("a saved override replaces the derived text on the ticket (admin default hidden)", () => {
    render(
      <KitchenTicket
        table={makeTable({
          kitchenCourseNotes: { danube: { modOverrides: { "CHARRED CUCUMBER": "CHARRED CUCUMBER + KOHLRABI" } } },
        })}
        menuCourses={[danube]}
        upd={vi.fn()}
      />
    );
    expect(screen.getByText(/1× CHARRED CUCUMBER \+ KOHLRABI/)).toBeTruthy();
    expect(screen.queryByText(/1× CHARRED CUCUMBER$/)).toBeNull();
  });

  it("editing the restriction text and saving persists modOverrides on kitchenCourseNotes only", () => {
    const upd = vi.fn();
    render(
      <KitchenTicket table={makeTable()} menuCourses={[danube]} upd={upd} editable />
    );
    fireEvent.click(screen.getByText("✏ EDIT"));
    const input = screen.getByLabelText("Restriction text for CHARRED CUCUMBER");
    // The applied text is written INTO the bar (and mirrored in the
    // placeholder) so staff extend what the kitchen already reads.
    expect(input.placeholder).toBe("CHARRED CUCUMBER");
    expect(input.value).toBe("CHARRED CUCUMBER");
    fireEvent.change(input, { target: { value: "CHARRED CUCUMBER, NO CREAM" } });
    fireEvent.click(screen.getByText("SAVE"));

    expect(upd).toHaveBeenCalledWith(1, "kitchenCourseNotes", {
      danube: { modOverrides: { "CHARRED CUCUMBER": "CHARRED CUCUMBER, NO CREAM" } },
    });
  });

  it("clearing the input drops the override so the admin default returns", () => {
    const upd = vi.fn();
    render(
      <KitchenTicket
        table={makeTable({
          kitchenCourseNotes: { danube: { modOverrides: { "CHARRED CUCUMBER": "SOMETHING ELSE" } } },
        })}
        menuCourses={[danube]}
        upd={upd}
        editable
      />
    );
    fireEvent.click(screen.getByText("✏ EDIT"));
    const input = screen.getByLabelText("Restriction text for CHARRED CUCUMBER");
    expect(input.value).toBe("SOMETHING ELSE");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("SAVE"));

    expect(upd).toHaveBeenCalledWith(1, "kitchenCourseNotes", {});
  });

  it("cancel discards a typed override (nothing persists)", () => {
    const upd = vi.fn();
    render(
      <KitchenTicket table={makeTable()} menuCourses={[danube]} upd={upd} editable />
    );
    fireEvent.click(screen.getByText("✏ EDIT"));
    fireEvent.change(screen.getByLabelText("Restriction text for CHARRED CUCUMBER"), {
      target: { value: "TYPED BUT ABANDONED" },
    });
    fireEvent.click(screen.getByText("CANCEL"));
    expect(upd).not.toHaveBeenCalled();
  });
});

describe("generateKitchenTicketsHTML — per-ticket restriction text override", () => {
  const resv = (kitchenCourseNotes = {}) => ({
    id: "r1",
    table_id: 5,
    data: {
      resName: "Novak", resTime: "19:00", guests: 2,
      restrictions: [{ pos: null, note: "veg" }],
      kitchenCourseNotes,
    },
  });

  it("prints the overridden text for the edited reservation", () => {
    const html = generateKitchenTicketsHTML(
      [resv({ danube: { modOverrides: { "CHARRED CUCUMBER": "CHARRED CUCUMBER + KOHLRABI" } } })],
      [danube],
    );
    expect(html).toContain("charred cucumber + kohlrabi");
  });

  it("prints the admin default when the reservation has no override", () => {
    const html = generateKitchenTicketsHTML([resv()], [danube]);
    expect(html).toContain("charred cucumber");
    expect(html).not.toContain("kohlrabi");
  });
});

// ── One bar per line: note and restriction text merged ───────────────────────
// The editor used to stack three fields per course — rename the dish, a free
// note, and (after #129) a separate restriction-text row. Per Djan the rename
// isn't needed and the note duplicated the restriction bar, so a course now
// gets ONE bar per line the ticket shows, pre-filled with the applied text.

const plain = { ...danube, course_key: "brioche", menu: { name: "BRIOCHE", sub: "" }, restrictions: {} };

describe("KitchenTicket editor — merged note/restriction bar", () => {
  it("has no dish-rename field any more", () => {
    render(<KitchenTicket table={makeTable()} menuCourses={[danube]} upd={vi.fn()} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    expect(screen.queryByPlaceholderText(/^Rename /)).toBeNull();
  });

  it("shows no separate note bar on a course that carries a restriction", () => {
    render(<KitchenTicket table={makeTable()} menuCourses={[danube]} upd={vi.fn()} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    // Only the restriction bar — the note field is the same bar now.
    expect(screen.queryByPlaceholderText(/^Note \(/)).toBeNull();
    expect(screen.getByLabelText("Restriction text for CHARRED CUCUMBER")).toBeTruthy();
  });

  it("falls back to a plain note bar on a course with no restriction", () => {
    const table = { ...makeTable(), restrictions: [] };
    render(<KitchenTicket table={table} menuCourses={[plain]} upd={vi.fn()} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    expect(screen.getByPlaceholderText(/^Note \(/)).toBeTruthy();
  });

  it("an emptied bar STAYS empty instead of the default springing back", () => {
    render(<KitchenTicket table={makeTable()} menuCourses={[danube]} upd={vi.fn()} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    const input = screen.getByLabelText("Restriction text for CHARRED CUCUMBER");
    fireEvent.change(input, { target: { value: "" } });
    // Deleting the key on blank re-rendered the default into the field and
    // made it impossible to retype.
    expect(screen.getByLabelText("Restriction text for CHARRED CUCUMBER").value).toBe("");
  });

  it("a blank bar is not a rewrite — nothing is stored and the default stands", () => {
    const upd = vi.fn();
    render(<KitchenTicket table={makeTable()} menuCourses={[danube]} upd={upd} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    fireEvent.change(screen.getByLabelText("Restriction text for CHARRED CUCUMBER"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("SAVE"));
    expect(upd).toHaveBeenCalledWith(1, "kitchenCourseNotes", {});
  });

  it("an existing note stays editable even once the course has a restriction", () => {
    // Otherwise a note written before the fields merged would be stranded on
    // the reservation: visible on the ticket, reachable nowhere.
    const table = makeTable({ kitchenCourseNotes: { danube: { note: "no chives" } } });
    render(<KitchenTicket table={table} menuCourses={[danube]} upd={vi.fn()} editable />);
    fireEvent.click(screen.getByText("✏ EDIT"));
    expect(screen.getByPlaceholderText(/^Note \(/).value).toBe("no chives");
  });
});
