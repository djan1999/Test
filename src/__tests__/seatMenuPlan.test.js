import { describe, it, expect } from "vitest";
import {
  buildSeatCourses,
  buildSeatMenu,
  courseKeyOf,
  defaultMenuTitle,
  defaultThankYou,
} from "../utils/seatMenuPlan.js";
import { renderSeatMenuHTML, seatSubtitle } from "../utils/seatMenuPrint.js";

// A course carries its restriction variants inline — the app stores full dish
// records, so a substitution is a lookup on the course, not a wording map.
const course = (name, sub, restrictions = {}, extra = {}) => ({
  course_key: name.toLowerCase().replace(/\s+/g, "_"),
  menu: { name, sub },
  restrictions,
  ...extra,
});

const COURSES = [
  course("Kefir", "Cucumber, dill", {
    dairy: { name: "Mountain herbs", sub: "Oat cream, rye crisp" },
  }),
  course("Žganci", "Pork crackling", {
    gluten: { name: "Polenta", sub: "Porcini, aged Tolminc" },
  }),
  course("Trout", "Beurre blanc", {
    veg: { name: "Kohlrabi", sub: "Horseradish, green apple" },
  }),
  // No variant for any restriction — must still print, never be dropped.
  course("Linzer Eye", "Redcurrant"),
];

describe("buildSeatCourses", () => {
  it("substitutes only the courses the restriction has a rule for", () => {
    const rows = buildSeatCourses({ courses: COURSES, restrictionKeys: ["gluten"] });
    expect(rows.map(r => r.name)).toEqual(["Kefir", "Polenta", "Trout", "Linzer Eye"]);
    expect(rows[1].substituted).toBe(true);
    expect(rows[1].substitutedFor).toBe("gluten");
    expect(rows[1].wasName).toBe("Žganci");
    expect(rows[0].substituted).toBe(false);
  });

  it("never drops a course that has no rule for the restriction", () => {
    const rows = buildSeatCourses({ courses: COURSES, restrictionKeys: ["nut"] });
    expect(rows).toHaveLength(COURSES.length);
    expect(rows.every(r => !r.substituted)).toBe(true);
    expect(rows[3].name).toBe("Linzer Eye");
  });

  it("applies every restriction a seat carries, each on its own course", () => {
    const rows = buildSeatCourses({ courses: COURSES, restrictionKeys: ["dairy", "gluten"] });
    expect(rows[0].name).toBe("Mountain herbs");
    expect(rows[0].substitutedFor).toBe("dairy");
    expect(rows[1].name).toBe("Polenta");
    expect(rows[1].substitutedFor).toBe("gluten");
  });

  it("drives the grey pairing line from the selected pairing set", () => {
    const withPairings = [course("Trout", "Beurre blanc", {}, {
      wp: { name: "Rebula", sub: "Goriška Brda" },
      na: { name: "Sea buckthorn", sub: "House kombucha" },
    })];
    expect(buildSeatCourses({ courses: withPairings, pairingSet: "Wine" })[0].pairing)
      .toBe("Rebula · Goriška Brda");
    expect(buildSeatCourses({ courses: withPairings, pairingSet: "Non-Alc" })[0].pairing)
      .toBe("Sea buckthorn · House kombucha");
    expect(buildSeatCourses({ courses: withPairings, pairingSet: "" })[0].pairing).toBe(null);
  });

  it("scopes a one-time edit to its course and flags it", () => {
    const rows = buildSeatCourses({
      courses: COURSES,
      restrictionKeys: [],
      edits: { [courseKeyOf(COURSES[0])]: { name: "Kefir, no dill" } },
    });
    expect(rows[0].name).toBe("Kefir, no dill");
    expect(rows[0].edited).toBe(true);
    expect(rows[1].edited).toBe(false);
  });

  it("uses the SI wording and SI variant when the run is in Slovene", () => {
    const si = [course("Kefir", "Cucumber, dill", {
      dairy: { name: "Mountain herbs", sub: "Oat cream" },
      dairy_si: { name: "Gorske zeli", sub: "Ovsena smetana" },
    }, { menu_si: { name: "Kefir", sub: "Kumare, koper" } })];
    expect(buildSeatCourses({ courses: si, restrictionKeys: [], lang: "si" })[0].sub)
      .toBe("Kumare, koper");
    expect(buildSeatCourses({ courses: si, restrictionKeys: ["dairy"], lang: "si" })[0].name)
      .toBe("Gorske zeli");
  });
});

describe("buildSeatMenu", () => {
  const restrictions = [
    { note: "gluten", pos: 1 },   // seat 1 only
    { note: "dairy", pos: null }, // unassigned — applies to every seat
  ];
  const seats = [{ id: 1 }, { id: 2 }];

  it("gives two seats at one table different menus", () => {
    const [a, b] = seats.map((seat, i) => buildSeatMenu({
      seat, seatNumber: i + 1, seatCount: 2, restrictions, courses: COURSES,
    }));
    expect(a.courses.map(c => c.name)).toEqual(["Mountain herbs", "Polenta", "Trout", "Linzer Eye"]);
    expect(b.courses.map(c => c.name)).toEqual(["Mountain herbs", "Žganci", "Trout", "Linzer Eye"]);
  });

  it("broadcasts a restriction with no seat number to every seat", () => {
    const seat2 = buildSeatMenu({ seat: { id: 2 }, seatNumber: 2, seatCount: 2, restrictions, courses: COURSES });
    expect(seat2.restrictionKeys).toContain("dairy");
    expect(seat2.courses[0].substitutedFor).toBe("dairy");
  });
});

describe("printed page", () => {
  const plan = buildSeatMenu({
    seat: { id: 1 }, seatNumber: 2, seatCount: 4,
    restrictions: [{ note: "gluten", pos: 1 }],
    courses: COURSES, pairingSet: "Wine",
    menuTitle: "WINTER MENU", thankYou: "Thank you.", wordmark: "MILKA",
  });

  it("builds the small-caps subtitle from title, seat and pairing set", () => {
    expect(seatSubtitle(plan)).toBe("WINTER MENU · SEAT 2 OF 4 · WINE");
  });

  it("renders substituted courses bold and keeps unchanged ones plain", () => {
    const html = renderSeatMenuHTML(plan);
    expect(html).toContain('<div class="course flagged"><div class="dish">Polenta</div>');
    expect(html).toContain('<div class="course"><div class="dish">Kefir</div>');
    expect(html).toContain("MILKA");
    expect(html).toContain("Thank you.");
  });

  it("escapes guest-facing text instead of injecting markup", () => {
    const evil = buildSeatMenu({
      seat: { id: 1 }, seatNumber: 1, seatCount: 1,
      courses: [course("<script>x</script>", "")],
    });
    expect(renderSeatMenuHTML(evil)).not.toContain("<script>x</script>");
  });
});

describe("defaults", () => {
  it("pre-fills the title per language and date", () => {
    const d = new Date(2026, 1, 14);
    expect(defaultMenuTitle("en", d)).toBe("MENU · 14 February 2026");
    expect(defaultMenuTitle("si", d)).toBe("MENI · 14. februar 2026");
    expect(defaultThankYou("si")).toBe("Hvala za vaš obisk.");
  });
});
