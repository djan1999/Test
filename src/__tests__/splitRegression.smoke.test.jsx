import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import AdminLayout from "../components/admin/AdminLayout.jsx";
import KitchenBoard from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function makeCourse(position = 1, overrides = {}) {
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
    ...overrides,
  };
}

describe("split regression smoke tests", () => {
  it("renders AdminLayout with minimal props", () => {
    expect(() =>
      render(
        <AdminLayout
          menuCourses={[makeCourse(1)]}
          onUpdateMenuCourses={vi.fn()}
          onSaveMenuCourses={vi.fn(async () => {})}
          menuTemplate={null}
          onUpdateTemplate={vi.fn()}
          onSaveTemplate={vi.fn(async () => {})}
          templateSaving={false}
          templateSaved={false}
          menuRules={{ overwriteTitleAndThankYouOnLanguageSwitch: true }}
          onUpdateMenuRules={vi.fn()}
          onSaveMenuRules={vi.fn(async () => {})}
          menuRulesSaving={false}
          menuRulesSaved={false}
          dishes={[]}
          wines={[]}
          cocktails={[]}
          spirits={[]}
          beers={[]}
          onUpdateWines={vi.fn()}
          onSaveBeverages={vi.fn(async () => {})}
          onSyncWines={vi.fn(async () => ({ ok: true }))}
          syncStatus="local-only"
          supabaseUrl=""
          hasSupabase={false}
          logoDataUri=""
          onSaveLogo={vi.fn()}
          layoutStyles={{}}
          onUpdateLayoutStyles={vi.fn()}
          onSaveLayoutStyles={vi.fn(async () => {})}
          layoutProfiles={[]}
          activeLayoutProfileId=""
          onSelectLayoutProfile={vi.fn()}
          onCreateLayoutProfile={vi.fn()}
          onDeleteLayoutProfile={vi.fn()}
          wineSyncConfig={null}
          onUpdateWineSyncConfig={vi.fn()}
          onSaveWineSyncConfig={vi.fn(async () => {})}
          quickAccessItems={[]}
          onUpdateQuickAccess={vi.fn()}
          onExit={vi.fn()}
        />
      )
    ).not.toThrow();
  });

  it("renders KitchenBoard with optional course safely", () => {
    const table = {
      id: 1,
      active: true,
      guests: 2,
      tableGroup: [],
      restrictions: [],
      seats: [
        { id: 1, water: "—", pairing: "", extras: { beetroot: { ordered: true, pairing: "—" } }, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
        { id: 2, water: "—", pairing: "", extras: {}, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
      ],
      kitchenLog: {},
      kitchenAlert: null,
      courseOverrides: {},
      kitchenCourseNotes: {},
      menuType: "",
      lang: "en",
      resName: "",
      resTime: "",
    };
    const courses = [makeCourse(1, { optional_flag: "beetroot", menu: { name: "Beetroot", sub: "" } })];
    expect(() =>
      render(
        <KitchenBoard
          tables={[table]}
          menuCourses={courses}
          upd={vi.fn()}
          updMany={vi.fn()}
        />
      )
    ).not.toThrow();
  });
});
