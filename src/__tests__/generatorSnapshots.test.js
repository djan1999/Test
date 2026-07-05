import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateMenuHTML } from "../utils/menuGenerator.js";

// generateMenuHTML prints TODAY's date in the menu header (there is no date
// parameter — the printed menu is always for the day it's generated). Pin the
// clock to the day these snapshots were recorded, or the two menu snapshots
// break at every midnight rollover.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-04T18:00:00"));
});
afterAll(() => vi.useRealTimers());
import {
  generateWeeklyReservationsHTML,
  generateWeeklyAllergyHTML,
  generateKitchenTicketsHTML,
} from "../utils/weeklyPrintGenerator.js";

// ── Contract lock ──────────────────────────────────────────────────────────────
// Snapshots of the printable outputs over ONE fixed fixture service day. These
// exist to catch unintended drift while the sync layer underneath is being
// rebuilt — the generators are pure, so their output must be byte-identical
// before and after any sync/storage refactor. If a snapshot diff shows up in a
// sync-layer PR, that PR broke something. Only update these snapshots in a PR
// that deliberately changes menu/print rendering.

// ── Fixture service day: Saturday 2026-06-06, two tables, mixed menus ─────────

function course(position, name, sub, opts = {}) {
  return {
    position,
    course_key: name.toLowerCase().replace(/\s+/g, "_"),
    course_category: opts.course_category || "main",
    menu: { name, sub },
    menu_si: opts.menu_si || null,
    optional_flag: opts.optional_flag || "",
    optional_pairing_flag: "",
    optional_pairing_label: "",
    optional_pairing_enabled: false,
    optional_pairing_default_on: true,
    optional_pairing_alco: null,
    optional_pairing_alco_si: null,
    optional_pairing_na: null,
    optional_pairing_na_si: null,
    show_on_short: opts.show_on_short || false,
    short_order: opts.short_order || null,
    section_gap_before: false,
    is_snack: opts.is_snack || false,
    is_active: true,
    restrictions: opts.restrictions || {},
    wp: opts.wp || null,
    na: opts.na || null,
    os: opts.os || null,
    premium: opts.premium || null,
    wp_si: null,
    na_si: null,
    os_si: null,
    premium_si: null,
    force_pairing_title: "",
    force_pairing_sub: "",
    force_pairing_title_si: "",
    force_pairing_sub_si: "",
    kitchen_note: opts.kitchen_note || "",
    aperitif_btn: null,
  };
}

const FIXTURE_COURSES = [
  course(1, "Amuse Bouche", "chef's welcome", { is_snack: true }),
  course(2, "Trout", "brook trout, fennel, elderflower", {
    wp: { name: "Rebula 2022", sub: "Goriška Brda" },
    na: { name: "Verjuice Spritz", sub: "house-pressed" },
    show_on_short: true,
    short_order: 1,
    restrictions: { gluten_free: { name: "Trout GF", sub: "no crumb" } },
  }),
  course(3, "Venison", "loin, blackberry, celeriac", {
    wp: { name: "Blaufränkisch 2019", sub: "Carinthia" },
    show_on_short: true,
    short_order: 2,
    kitchen_note: "fire on pickup call",
  }),
  course(4, "Walnut Cake", "walnut, plum, sour cream", {
    course_category: "celebration",
    optional_flag: "cake",
  }),
];

const FIXTURE_RESERVATIONS = [
  {
    id: "resv-1",
    date: "2026-06-06",
    table_id: 2,
    data: {
      resName: "Kovač",
      resTime: "18:30",
      guests: 4,
      menuType: "long",
      guestType: "hotel",
      rooms: ["12"],
      birthday: true,
      cakeNote: "40th",
      notes: "window seat",
      restrictions: [
        { note: "gluten_free", pos: 2 },
        { note: "custom_allergy", pos: 4, detail: "no coriander" },
      ],
    },
  },
  {
    id: "resv-2",
    date: "2026-06-06",
    table_id: 5,
    data: {
      resName: "Smith",
      resTime: "12:15",
      guests: 2,
      menuType: "short",
      restrictions: [],
    },
  },
  {
    id: "resv-outside-week",
    date: "2026-07-20",
    table_id: 1,
    data: { resName: "Later", resTime: "19:00", guests: 2 },
  },
];

const RESTRICTION_DEFS = [
  { key: "gluten_free", label: "Gluten Free" },
  { key: "veg", label: "Vegetarian" },
];

// Monday 2026-06-01 … Sunday 2026-06-07 (Date objects, as the callers pass).
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => new Date(2026, 5, 1 + i));

const FIXTURE_SEAT = {
  id: 1,
  pairing: "Wine",
  water: "Sparkling",
  extras: { cake: { ordered: true, pairing: "—" } },
  glasses: [{ id: "manual|rebula", name: "Rebula 2022", producer: "Marjan Simčič", byGlass: true }],
  cocktails: [],
  beers: [],
  aperitifs: [],
  spirits: [],
  optionalPairings: {},
};

const FIXTURE_TABLE = {
  id: 2,
  menuType: "long",
  resName: "Kovač",
  restrictions: [{ note: "gluten_free", pos: 1 }],
  bottleWines: [],
};

describe("generator snapshots — fixture service day (contract lock)", () => {
  it("generateMenuHTML output is stable", () => {
    const html = generateMenuHTML({
      seat: FIXTURE_SEAT,
      table: FIXTURE_TABLE,
      menuCourses: FIXTURE_COURSES,
      menuTitle: "SUMMER MENU",
      teamNames: "Ana, Bor",
      thankYouNote: "Thank you for dining with us.",
      lang: "en",
    });
    expect(html).toMatchSnapshot();
  });

  it("generateMenuHTML Slovenian output is stable", () => {
    const html = generateMenuHTML({
      seat: { ...FIXTURE_SEAT, pairing: "Non-Alc" },
      table: { ...FIXTURE_TABLE, lang: "si" },
      menuCourses: FIXTURE_COURSES,
      menuTitle: "POLETNI MENI",
      thankYouNote: "Hvala za vaš obisk.",
      lang: "si",
    });
    expect(html).toMatchSnapshot();
  });

  it("generateWeeklyReservationsHTML output is stable", () => {
    const html = generateWeeklyReservationsHTML(FIXTURE_RESERVATIONS, WEEK_DAYS, RESTRICTION_DEFS);
    expect(html).toMatchSnapshot();
  });

  it("generateWeeklyAllergyHTML output is stable", () => {
    const html = generateWeeklyAllergyHTML(
      FIXTURE_RESERVATIONS, FIXTURE_COURSES, WEEK_DAYS, RESTRICTION_DEFS, [], {},
    );
    expect(html).toMatchSnapshot();
  });

  it("generateKitchenTicketsHTML output is stable", () => {
    const html = generateKitchenTicketsHTML(
      FIXTURE_RESERVATIONS.filter(r => r.date === "2026-06-06"),
      FIXTURE_COURSES, RESTRICTION_DEFS, [], {},
    );
    expect(html).toMatchSnapshot();
  });
});
