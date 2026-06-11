import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SheetView from "../components/service/SheetView.jsx";

function makeCourse(position, name) {
  return {
    position,
    menu: { name, sub: "" },
    menu_si: null,
    is_snack: false,
    is_active: true,
    course_key: `course_${position}`,
    optional_flag: "",
    course_category: "main",
  };
}

const MENU = [makeCourse(1, "Amuse"), makeCourse(2, "Bread"), makeCourse(3, "Fish")];

function makeTable(over = {}) {
  return {
    id: 3,
    active: true,
    resName: "Novak",
    resTime: "19:00",
    arrivedAt: "18:55",
    guests: 2,
    menuType: "long",
    seats: [
      { id: 1, water: "still", pairing: "wine" },
      { id: 2, water: "—", pairing: "—" },
    ],
    restrictions: [{ pos: 1, note: "shellfish" }],
    kitchenLog: { course_1: { firedAt: "19:05" } },
    ...over,
  };
}

function setViewport(width) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

function renderSheet(over = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onOpenDetail: vi.fn(),
    onFireNext: vi.fn(),
    onUndoFire: vi.fn(),
    onSeat: vi.fn(),
    onUnseat: vi.fn(),
  };
  render(
    <SheetView
      tables={[makeTable()]}
      menuCourses={MENU}
      selectedId={null}
      {...handlers}
      {...over}
    />
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  setViewport(1280);
});

describe("SheetView smoke tests", () => {
  it("renders the desktop 3-column sheet with course state and rails", () => {
    setViewport(1280);
    renderSheet();

    expect(screen.getByText("[TABLES]")).toBeInTheDocument();
    expect(screen.getByText("[COURSE PROGRESSION]")).toBeInTheDocument();
    expect(screen.getByText("[COURSE STATE]")).toBeInTheDocument();
    expect(screen.getByText("[GUEST MATRIX]")).toBeInTheDocument();
    expect(screen.getByText("[ALERTS · INTELLIGENCE]")).toBeInTheDocument();
    expect(screen.getByText("[TIMELINE]")).toBeInTheDocument();
    // course_1 fired → current is Amuse, next fire is Bread
    expect(screen.getByText("FIRE C02 · Bread")).toBeInTheDocument();
  });

  it("fires the next course and undoes the last fire", () => {
    setViewport(1280);
    const h = renderSheet();

    fireEvent.click(screen.getByText("FIRE C02 · Bread"));
    expect(h.onFireNext).toHaveBeenCalledWith(3, "course_2");

    fireEvent.click(screen.getByText("UNDO LAST FIRE"));
    expect(h.onUndoFire).toHaveBeenCalledWith(3, "course_1");
  });

  it("renders the mobile single-column layout with chip selector", () => {
    setViewport(390);
    const h = renderSheet();

    // chip selector replaces the table index rail
    expect(screen.queryByText("[TABLES]")).not.toBeInTheDocument();
    expect(screen.getByText("T03 · Novak")).toBeInTheDocument();
    // mobile fire button drops the course name so it can't overflow
    expect(screen.getByText("FIRE C02")).toBeInTheDocument();

    fireEvent.click(screen.getByText("T03 · Novak"));
    expect(h.onSelect).toHaveBeenCalledWith(3);
  });

  it("shows SEAT for reserved tables and EDIT · DETAIL opens detail", () => {
    setViewport(1280);
    const h = renderSheet({
      tables: [makeTable({ active: false, arrivedAt: null, kitchenLog: {} })],
    });

    fireEvent.click(screen.getByRole("button", { name: "SEAT" }));
    expect(h.onSeat).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByText("EDIT · DETAIL"));
    expect(h.onOpenDetail).toHaveBeenCalledWith(3);
  });

  it("derives intelligence signals: fire cadence and pace vs the room", () => {
    setViewport(1280);
    // Table 3 has fired 1/3 courses; table 5 has fired 2/3 → room avg is
    // ahead, so table 3 reads BEHIND ROOM by 1 course.
    renderSheet({
      tables: [
        makeTable(),
        makeTable({
          id: 5, resName: "Kos",
          kitchenLog: { course_1: { firedAt: "19:02" }, course_2: { firedAt: "19:20" } },
        }),
      ],
    });

    expect(screen.getByText(/SEATED \d/)).toBeInTheDocument();
    expect(screen.getByText(/^(LAST FIRE|NO FIRE FOR)/)).toBeInTheDocument();
    expect(screen.getByText("BEHIND ROOM · 1 COURSE")).toBeInTheDocument();
  });

  it("shows ALL COURSES OUT when the menu is complete", () => {
    setViewport(1280);
    renderSheet({
      tables: [makeTable({
        kitchenLog: {
          course_1: { firedAt: "19:05" },
          course_2: { firedAt: "19:25" },
          course_3: { firedAt: "19:50" },
        },
      })],
    });

    expect(screen.getByText("ALL COURSES OUT")).toBeInTheDocument();
  });

  it("renders the empty state when no tables exist", () => {
    setViewport(1280);
    renderSheet({ tables: [] });
    expect(screen.getByText("Select a table from the list")).toBeInTheDocument();
  });
});
