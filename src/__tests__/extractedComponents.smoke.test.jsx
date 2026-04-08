import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminPanel from "../components/admin/AdminPanel.jsx";
import ReservationModal from "../components/reservations/ReservationModal.jsx";

function makeCourse(position = 1) {
  return {
    position,
    menu: { name: `Course ${position}`, sub: "" },
    menu_si: null,
    wp: null,
    wp_si: null,
    na: null,
    na_si: null,
    os: null,
    os_si: null,
    premium: null,
    premium_si: null,
    hazards: null,
    is_snack: false,
    course_key: `course_${position}`,
    optional_flag: "",
    section_gap_before: false,
    show_on_short: false,
    short_order: null,
    force_pairing_title: "",
    force_pairing_sub: "",
    force_pairing_title_si: "",
    force_pairing_sub_si: "",
    kitchen_note: "",
    aperitif_btn: null,
    restrictions: {},
  };
}

describe("extracted component smoke tests", () => {
  it("renders AdminPanel without crashing", () => {
    render(
      <AdminPanel
        dishes={[]}
        wines={[]}
        cocktails={[]}
        spirits={[]}
        beers={[]}
        menuCourses={[makeCourse(1)]}
        onUpdateDishes={vi.fn()}
        onUpdateWines={vi.fn()}
        onSaveBeverages={vi.fn()}
        onResetMenuLayout={vi.fn()}
        onUpdateMenuCourses={vi.fn()}
        onSaveMenuCourses={vi.fn(async () => {})}
        onSyncWines={vi.fn(async () => ({ ok: true }))}
        logoDataUri=""
        onSaveLogo={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByText("Menu Layout")).toBeInTheDocument();
  });

  it("renders ReservationModal and basic controls", () => {
    render(
      <ReservationModal
        table={{ id: 1, guests: 2, tableGroup: [1], restrictions: [] }}
        tables={Array.from({ length: 10 }, (_, i) => ({ id: i + 1, active: false }))}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("TABLE · RESERVATION")).toBeInTheDocument();
    expect(screen.getByText("SAVE")).toBeInTheDocument();
    expect(screen.getByText("CANCEL")).toBeInTheDocument();
  });
});
