import { describe, it, expect } from "vitest";
import { generateMenuHTML } from "../utils/menuGenerator.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeSeat(overrides = {}) {
  return { id: 1, pairing: "—", extras: {}, glasses: [], cocktails: [], beers: [], ...overrides };
}

function makeTable(overrides = {}) {
  return { menuType: "", restrictions: [], bottleWines: [], birthday: false, ...overrides };
}

function makeCourse(name, sub = "", opts = {}) {
  return {
    course_key: name.toLowerCase().replace(/\s+/g, "_"),
    menu: { name, sub },
    menu_si: opts.menu_si || null,
    position: opts.position ?? 1,
    optional_flag: opts.optional_flag || "",
    show_on_short: opts.show_on_short || false,
    short_order: opts.short_order || null,
    section_gap_before: false,
    is_snack: false,
    restrictions: opts.restrictions || {},
    wp: opts.wp || null,
    na: opts.na || null,
    os: opts.os || null,
    premium: opts.premium || null,
    wp_si: opts.wp_si || null,
    force_pairing_title: opts.force_pairing_title || "",
    force_pairing_sub: opts.force_pairing_sub || "",
    force_pairing_title_si: opts.force_pairing_title_si || "",
    force_pairing_sub_si: opts.force_pairing_sub_si || "",
  };
}

function render(seatOpts = {}, tableOpts = {}, courses = [], genOpts = {}) {
  return generateMenuHTML({
    seat: makeSeat(seatOpts),
    table: makeTable(tableOpts),
    menuCourses: courses,
    ...genOpts,
  });
}

// ── Basic structure ────────────────────────────────────────────────────────────

describe("generateMenuHTML — basic structure", () => {
  it("returns a valid HTML document string", () => {
    const html = render();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes the menu title in the output", () => {
    const html = render({}, {}, [], { menuTitle: "SPRING MENU" });
    expect(html).toContain("SPRING MENU");
  });

  it("HTML-escapes special characters in the menu title", () => {
    const html = render({}, {}, [], { menuTitle: 'A & B <Menu>' });
    expect(html).toContain("A &amp; B &lt;Menu&gt;");
    expect(html).not.toContain("<Menu>");
  });

  it("includes the thank-you note", () => {
    const html = render({}, {}, [], { thankYouNote: "See you again soon." });
    expect(html).toContain("See you again soon.");
  });

  it("includes team names", () => {
    const html = render({}, {}, [], { teamNames: "Alice, Bob" });
    expect(html).toContain("Alice, Bob");
  });

  it("returns an empty courses section when no menuCourses provided", () => {
    const html = render();
    // Should still be valid HTML
    expect(html).toContain('<div id="menu">');
    // No course rows — only the thank-you div should be inside #menu
    expect(html).not.toContain('class="menu-row');
  });
});

// ── Course rendering ───────────────────────────────────────────────────────────

describe("generateMenuHTML — course rendering", () => {
  it("renders course name in the left column", () => {
    const courses = [makeCourse("LAMB", "rosemary jus")];
    const html = render({}, {}, courses);
    expect(html).toContain("LAMB");
    expect(html).toContain("rosemary jus");
  });

  it("HTML-escapes dish names", () => {
    const courses = [makeCourse("DUCK & LIVER", "reduction")];
    const html = render({}, {}, courses);
    expect(html).toContain("DUCK &amp; LIVER");
    expect(html).not.toContain("DUCK & LIVER");
  });

  it("renders multiple courses in order", () => {
    const courses = [
      makeCourse("SOUP", "", { position: 1 }),
      makeCourse("MAIN", "", { position: 2 }),
      makeCourse("DESSERT", "", { position: 3 }),
    ];
    const html = render({}, {}, courses);
    const soupIdx  = html.indexOf("SOUP");
    const mainIdx  = html.indexOf("MAIN");
    const dessertIdx = html.indexOf("DESSERT");
    expect(soupIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(dessertIdx);
  });
});

// ── Dietary restriction application ───────────────────────────────────────────

describe("generateMenuHTML — restriction substitutions", () => {
  it("substitutes veg alternative when seat has veg restriction", () => {
    const courses = [makeCourse("LAMB", "rosemary jus", {
      restrictions: { veg: { name: "MUSHROOM", sub: "truffle" } },
    })];
    const tableWithRestriction = makeTable({
      restrictions: [{ note: "veg" }],
    });
    const html = generateMenuHTML({
      seat: makeSeat({ id: 1 }),
      table: tableWithRestriction,
      menuCourses: courses,
    });
    expect(html).toContain("MUSHROOM");
    expect(html).not.toContain(">LAMB<");
  });

  it("keeps original dish when restriction has no matching course data", () => {
    const courses = [makeCourse("LAMB", "rosemary jus", { restrictions: {} })];
    const tableWithRestriction = makeTable({
      restrictions: [{ note: "gluten" }],
    });
    const html = generateMenuHTML({
      seat: makeSeat({ id: 1 }),
      table: tableWithRestriction,
      menuCourses: courses,
    });
    expect(html).toContain("LAMB");
  });

  it("only applies restriction to the matching seat, not others", () => {
    // Restriction with pos: 1 only applies to seat 1
    const courses = [makeCourse("LAMB", "", {
      restrictions: { veg: { name: "TOFU", sub: "" } },
    })];
    const tableWithRestriction = makeTable({
      restrictions: [{ note: "veg", pos: 1 }],
    });
    // Seat 2 — should see LAMB
    const htmlSeat2 = generateMenuHTML({
      seat: makeSeat({ id: 2 }),
      table: tableWithRestriction,
      menuCourses: courses,
    });
    expect(htmlSeat2).toContain("LAMB");
    expect(htmlSeat2).not.toContain("TOFU");

    // Seat 1 — should see TOFU
    const htmlSeat1 = generateMenuHTML({
      seat: makeSeat({ id: 1 }),
      table: tableWithRestriction,
      menuCourses: courses,
    });
    expect(htmlSeat1).toContain("TOFU");
  });
});

// ── Extras filtering (beetroot / cheese / cake) ───────────────────────────────

describe("generateMenuHTML — extras filtering", () => {
  const beetrootCourse = makeCourse("BEETROOT", "bear fat", { optional_flag: "beetroot" });
  const cheeseCourse   = makeCourse("CHEESE", "condiments", { optional_flag: "cheese" });
  const cakeCourse     = makeCourse("PEAR", "walnut", { optional_flag: "cake" });
  const mainCourse     = makeCourse("LAMB", "rosemary");

  it("hides beetroot course when seat has not ordered beetroot", () => {
    const html = render({}, {}, [mainCourse, beetrootCourse]);
    expect(html).toContain("LAMB");
    expect(html).not.toContain("BEETROOT");
  });

  it("shows beetroot course when seat has ordered beetroot", () => {
    const html = render({ extras: { 1: { ordered: true } } }, {}, [mainCourse, beetrootCourse]);
    expect(html).toContain("BEETROOT");
  });

  it("hides cheese course when not ordered", () => {
    const html = render({}, {}, [mainCourse, cheeseCourse]);
    expect(html).not.toContain("CHEESE");
  });

  it("shows cheese course when ordered", () => {
    const html = render({ extras: { 2: { ordered: true } } }, {}, [mainCourse, cheeseCourse]);
    expect(html).toContain("CHEESE");
  });

  it("shows cake course when table has birthday flag", () => {
    const html = render({}, { birthday: true }, [mainCourse, cakeCourse]);
    expect(html).toContain("PEAR");
  });

  it("hides cake course when no birthday and not ordered", () => {
    const html = render({}, {}, [mainCourse, cakeCourse]);
    expect(html).not.toContain("PEAR");
  });
});

// ── Short menu filtering ───────────────────────────────────────────────────────

describe("generateMenuHTML — short menu", () => {
  const courses = [
    makeCourse("SOUP",     "", { position: 1, show_on_short: true,  short_order: 1 }),
    makeCourse("SALAD",    "", { position: 2, show_on_short: false, short_order: 2 }),
    makeCourse("MAIN",     "", { position: 3, show_on_short: true,  short_order: 2 }),
    makeCourse("DESSERT",  "", { position: 4, show_on_short: false, short_order: 3 }),
  ];

  it("shows all courses when menuType is not 'short'", () => {
    const html = render({}, { menuType: "" }, courses);
    expect(html).toContain("SOUP");
    expect(html).toContain("SALAD");
    expect(html).toContain("MAIN");
    expect(html).toContain("DESSERT");
  });

  it("only shows courses flagged show_on_short when menuType is 'short'", () => {
    const html = render({}, { menuType: "short" }, courses);
    expect(html).toContain("SOUP");
    expect(html).toContain("MAIN");
    expect(html).not.toContain("SALAD");
    expect(html).not.toContain("DESSERT");
  });

  it("orders short menu courses by short_order", () => {
    const html = render({}, { menuType: "short" }, courses);
    const soupIdx = html.indexOf("SOUP");
    const mainIdx = html.indexOf("MAIN");
    expect(soupIdx).toBeLessThan(mainIdx);
  });
});

// ── Pairing ───────────────────────────────────────────────────────────────────

describe("generateMenuHTML — pairing", () => {
  const wineEntry = { name: "Klinec Mora", sub: "Brda, Slovenia" };
  const courses = [
    makeCourse("TROUT", "", { position: 1, wp: wineEntry }),
    makeCourse("LAMB",  "", { position: 2, wp: wineEntry }),
  ];

  it("shows no pairing section when seat pairing is '—'", () => {
    const html = render({ pairing: "—" }, {}, courses);
    expect(html).not.toContain("WINE PAIRING");
  });

  it("shows WINE PAIRING section header when seat has Wine pairing", () => {
    const html = render({ pairing: "Wine" }, {}, courses);
    expect(html).toContain("WINE PAIRING");
  });

  it("shows NON-ALCO PAIRING section header for Non-Alc pairing", () => {
    const naEntry = { name: "Elderflower", sub: "sparkling" };
    const naCourses = [makeCourse("TROUT", "", { na: naEntry })];
    const html = render({ pairing: "Non-Alc" }, {}, naCourses);
    expect(html).toContain("NON-ALCO PAIRING");
  });

  it("includes wine name in right column when pairing active", () => {
    const html = render({ pairing: "Wine" }, {}, courses);
    expect(html).toContain("Klinec Mora");
  });
});

// ── SI language ───────────────────────────────────────────────────────────────

describe("generateMenuHTML — SI language", () => {
  const courseWithSI = makeCourse("LAMB", "rosemary", {
    menu_si: { name: "JAGNJE", sub: "rožmarin" },
  });

  it("shows EN dish name by default", () => {
    const html = render({}, {}, [courseWithSI]);
    expect(html).toContain("LAMB");
    expect(html).not.toContain("JAGNJE");
  });

  it("shows SI dish name when lang=si", () => {
    const html = render({}, {}, [courseWithSI], { lang: "si" });
    expect(html).toContain("JAGNJE");
  });

  it("shows Slovenian pairing label when lang=si", () => {
    const wineEntry = { name: "Klinec", sub: "" };
    const courses = [makeCourse("LAMB", "", { wp: wineEntry })];
    const html = render({ pairing: "Wine" }, {}, courses, { lang: "si" });
    expect(html).toContain("VINSKA SPREMLJAVA");
    expect(html).not.toContain("WINE PAIRING");
  });

  it("shows Slovenian date format when lang=si", () => {
    const html = render({}, {}, [], { lang: "si" });
    // Slovenian months
    const siMonths = ["Januar","Februar","Marec","April","Maj","Junij","Julij","Avgust","September","Oktober","November","December"];
    const anySlMonth = siMonths.some(m => html.includes(m));
    expect(anySlMonth).toBe(true);
  });
});

// ── Seat output overrides ─────────────────────────────────────────────────────

describe("generateMenuHTML — seatOutputOverrides", () => {
  it("applies per-seat course name override", () => {
    const courses = [makeCourse("LAMB", "rosemary")];
    const html = render({}, {}, courses, {
      seatOutputOverrides: { lamb: { name: "VENISON" } },
    });
    expect(html).toContain("VENISON");
    expect(html).not.toContain(">LAMB<");
  });

  it("applies per-seat sub override while keeping original name", () => {
    const courses = [makeCourse("LAMB", "rosemary")];
    const html = render({}, {}, courses, {
      seatOutputOverrides: { lamb: { sub: "truffle jus" } },
    });
    expect(html).toContain("LAMB");
    expect(html).toContain("truffle jus");
    expect(html).not.toContain("rosemary");
  });
});

// ── Wine formatting ───────────────────────────────────────────────────────────

describe("generateMenuHTML — wine country name expansion", () => {
  it("expands country code to full name in pairing right column", () => {
    const bottle = { producer: "Movia", name: "Lunar", vintage: "2019", country: "SI", region: "Brda" };
    const courses = [makeCourse("TROUT", "", { position: 1 })];
    const html = generateMenuHTML({
      seat: makeSeat({ pairing: "—", glasses: [bottle] }),
      table: makeTable(),
      menuCourses: courses,
    });
    // By-glass wines appear in right column after Danube Salmon index
    // With only 1 course the by-glass queue won't fire, but bottle will appear
    // in wine-only row from the bottle queue
    expect(html).toContain("Slovenia");
  });

  it("formats vintage as two-digit shorthand ('19 for 2019)", () => {
    const bottle = { producer: "Movia", name: "Lunar", vintage: "2019", country: "SI" };
    const html = generateMenuHTML({
      seat: makeSeat({ glasses: [bottle] }),
      table: makeTable(),
      menuCourses: [],
    });
    expect(html).toContain("'19");
  });
});

// ── layoutStyles ───────────────────────────────────────────────────────────────

describe("generateMenuHTML — layoutStyles", () => {
  it("uses default rowSpacing when layoutStyles is empty", () => {
    const html = render({}, {}, [], { layoutStyles: {} });
    expect(html).toContain("margin-bottom:3.15pt");
  });

  it("applies custom rowSpacing to .menu-row style", () => {
    const html = render({}, {}, [], { layoutStyles: { rowSpacing: 5 } });
    expect(html).toContain("margin-bottom:5pt");
    expect(html).not.toContain("margin-bottom:3.15pt");
  });

  it("applies custom padLeft as --pad-l CSS variable", () => {
    const html = render({}, {}, [], { layoutStyles: { padLeft: 20 } });
    expect(html).toContain("--pad-l:20mm");
  });

  it("uses default padLeft when not in layoutStyles", () => {
    const html = render({}, {}, [], { layoutStyles: {} });
    expect(html).toContain("--pad-l:12mm");
  });

  it("applies custom fontSize to html,body font-size rule", () => {
    const html = render({}, {}, [], { layoutStyles: { fontSize: 8 } });
    expect(html).toContain("font-size:8pt");
  });

  it("applies custom logoSize to #logo img width", () => {
    const html = render({}, {}, [], { layoutStyles: { logoSize: 25 } });
    expect(html).toContain("width:25mm");
  });

  it("applies custom wineRowSpacing to .menu-row.wine-only", () => {
    const html = render({}, {}, [], { layoutStyles: { wineRowSpacing: 7 } });
    expect(html).toContain("margin-bottom:7pt");
  });

  it("applies custom thankYouSpacing to .menu-thankyou margin-top", () => {
    const html = render({}, {}, [], { layoutStyles: { thankYouSpacing: 12 } });
    expect(html).toContain("margin-top:12pt");
  });

  it("applies custom headerSpacing to #header margin-bottom", () => {
    const html = render({}, {}, [], { layoutStyles: { headerSpacing: 15 } });
    expect(html).toContain("margin-bottom:15mm");
  });

  it("renders logo img when _logo is provided", () => {
    const html = render({}, {}, [], { _logo: "data:image/svg+xml;base64,abc123" });
    expect(html).toContain('<div id="logo">');
    expect(html).toContain('<img src="data:image/svg+xml;base64,abc123" alt="Logo">');
  });

  it("omits logo div entirely when _logo is empty", () => {
    const html = render({}, {}, [], { _logo: "" });
    expect(html).not.toContain('<div id="logo">');
  });

  it("logo img uses generic alt text, not a hardcoded restaurant name", () => {
    const html = render({}, {}, [], { _logo: "data:image/png;base64,xyz" });
    expect(html).toContain('alt="Logo"');
    expect(html).not.toContain('alt="Milka"');
  });

  it("applies custom padTop and padBottom as CSS variables", () => {
    const html = render({}, {}, [], { layoutStyles: { padTop: 10, padBottom: 6 } });
    expect(html).toContain("--pad-t:10mm");
    expect(html).toContain("--pad-b:6mm");
  });
});
