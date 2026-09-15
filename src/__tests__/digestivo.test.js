import { describe, it, expect } from "vitest";
import {
  courseAnchorsDigestivo,
  digestivoVariants,
  digestivoCycleStates,
  digestivoDisplayName,
  digestivoCurrentState,
  digestivoNextState,
  cycleSeatDigestivo,
  digestivoEntry,
  addSeatDigestivo,
  digestivoEntryMatchesOption,
  digestivoAnchorKeys,
  isDigestivoAnchor,
  seatDigestivoNames,
  digestivoSeatOrders,
  digestivoTicketLine,
  digestivoCount,
} from "../utils/digestivo.js";
import { makeSeats } from "../utils/tableHelpers.js";
import { kitchenSnapshot, kitchenDelta } from "../utils/kitchenAlerts.js";
import { supabaseRowToCourse, courseToSupabaseRow } from "../utils/menuCourseMapper.js";
import { generateKitchenTicketHTML } from "../utils/kitchenTicketGenerator.js";

const course = (over = {}) => ({
  course_key: "buchtel",
  menu: { name: "Buchtel", sub: "" },
  ...over,
});

describe("which course the digestivo is served before", () => {
  it("is opt-in — a course that says nothing anchors nothing", () => {
    expect(courseAnchorsDigestivo(course())).toBe(false);
    expect(courseAnchorsDigestivo(course({ digestivo_before: "yes" }))).toBe(false);
    expect(courseAnchorsDigestivo(course({ digestivo_before: true }))).toBe(true);
  });

  it("ignores an archived course, which never reaches a ticket anyway", () => {
    expect(courseAnchorsDigestivo(course({ digestivo_before: true, is_active: false }))).toBe(false);
  });

  it("collects every anchored key, so short and long menus can each have one", () => {
    const keys = digestivoAnchorKeys([
      course({ course_key: "Buchtel", digestivo_before: true }),
      course({ course_key: "pork_cakes", digestivo_before: true }),
      course({ course_key: "danube", digestivo_before: false }),
      course({ course_key: "", digestivo_before: true }),
    ]);
    expect([...keys].sort()).toEqual(["buchtel", "pork_cakes"]);
  });

  it("matches a course against the anchor set regardless of key casing", () => {
    const keys = digestivoAnchorKeys([course({ course_key: "buchtel", digestivo_before: true })]);
    expect(isDigestivoAnchor(course({ course_key: "BUCHTEL" }), keys)).toBe(true);
    expect(isDigestivoAnchor(course({ course_key: "danube" }), keys)).toBe(false);
    expect(isDigestivoAnchor(course({ course_key: "" }), keys)).toBe(false);
  });

  it("also accepts the raw course list, for callers that have not built the set", () => {
    const courses = [course({ digestivo_before: true })];
    expect(isDigestivoAnchor(course(), courses)).toBe(true);
  });
});

describe("what the ticket line says", () => {
  const seat = (id, names) => ({ id, digestivos: names.map((name) => ({ name })) });

  it("collapses a round of the same drink into one ×n", () => {
    expect(seatDigestivoNames(seat(1, ["Espresso", "Espresso"]))).toEqual(["Espresso ×2"]);
  });

  it("keeps two different drinks on the same chair apart", () => {
    expect(seatDigestivoNames(seat(1, ["Espresso", "Grappa"]))).toEqual(["Espresso", "Grappa"]);
  });

  it("leaves out the chairs that ordered nothing", () => {
    const orders = digestivoSeatOrders([seat(1, ["Espresso"]), seat(2, []), seat(3, ["Grappa"])]);
    expect(orders.map((o) => o.seatId)).toEqual([1, 3]);
  });

  it("names every ordering chair on one line", () => {
    expect(digestivoTicketLine([seat(1, ["Espresso", "Espresso"]), seat(2, []), seat(3, ["Grappa"])]))
      .toBe("P1 Espresso ×2 · P3 Grappa");
  });

  it("has no line at all when nobody ordered one", () => {
    expect(digestivoTicketLine([seat(1, []), seat(2, [])])).toBeNull();
    expect(digestivoTicketLine([])).toBeNull();
    expect(digestivoCount([seat(1, []), seat(2, [])])).toBe(0);
  });

  it("counts every pour, not every chair", () => {
    expect(digestivoCount([seat(1, ["Espresso", "Espresso"]), seat(2, ["Grappa"])])).toBe(3);
  });
});

describe("the seat factory carries digestivos", () => {
  it("defaults to an empty list", () => {
    expect(makeSeats(1)[0].digestivos).toEqual([]);
  });

  it("keeps the picks already on the chair", () => {
    expect(makeSeats(1, [{ digestivos: [{ name: "Tea" }] }])[0].digestivos).toEqual([{ name: "Tea" }]);
  });
});

describe("one shape for a stored pick, wherever it was recorded", () => {
  // A button on the board, the search beside it, the detail sheet's party-wide
  // add: three surfaces, and a pick that loses `baseName` on any of them stops
  // being recognised by the button that could take it off again.
  it("folds the subcategory into the name and keeps the matching fields beside it", () => {
    expect(digestivoEntry({ name: "Coffee", notes: "" }, { baseName: "Coffee", variant: "Decaf", optionId: 7 }))
      .toEqual({ name: "Coffee (Decaf)", baseName: "Coffee", variant: "Decaf", digestivoId: 7, notes: "" });
  });

  it("omits what it was not given rather than storing a null", () => {
    const e = digestivoEntry({ name: "Grappa", notes: "" });
    expect(e).toEqual({ name: "Grappa", baseName: "Grappa", notes: "" });
    expect("variant" in e).toBe(false);
    expect("digestivoId" in e).toBe(false);
  });

  it("is the shape the board button and the search both write", () => {
    const fromButton = cycleSeatDigestivo({ id: 1, digestivos: [] }, COFFEE, product("Coffee"), {});
    const fromSearch = addSeatDigestivo({ id: 1, digestivos: [] }, { name: "Chartreuse", notes: "" });
    expect(Object.keys(fromButton[0])).toContain("baseName");
    expect(fromSearch[0]).toMatchObject({ name: "Chartreuse", baseName: "Chartreuse" });
  });
});

describe("the digestivo stays off the kitchen popup", () => {
  // It is a service line on the TICKET, read at the course it is served
  // before. The popup is for work the pass has to start — a plate, a pairing,
  // a dietary — and a coffee is not that. Anything that put the digestivo back
  // on the Send delta would put a popup in front of the line for every
  // espresso, and a popup that fires for noise stops being read for signal.
  const snap = (digestivos) => kitchenSnapshot([{ id: 1, extras: {}, pairing: "Wine", digestivos }]);

  it("keeps the picks out of the snapshot entirely", () => {
    expect(snap([{ name: "Espresso" }, { name: "Espresso" }])[1].digestivos).toBeUndefined();
  });

  it("raises no delta the first time a guest orders one", () => {
    expect(kitchenDelta(snap([{ name: "Espresso" }]), snap([]))).toEqual([]);
  });

  it("raises no delta when the round grows, or when it is cancelled", () => {
    expect(kitchenDelta(snap([{ name: "Espresso" }, { name: "Espresso" }]), snap([{ name: "Espresso" }]))).toEqual([]);
    expect(kitchenDelta(snap([]), snap([{ name: "Espresso" }]))).toEqual([]);
  });

  it("puts no digestivo on a delta seat that is sending something else", () => {
    const before = kitchenSnapshot([{ id: 1, extras: {}, pairing: "Wine", digestivos: [] }]);
    const after = kitchenSnapshot([{ id: 1, extras: {}, pairing: "Non-Alc", digestivos: [{ name: "Espresso" }] }]);
    const delta = kitchenDelta(after, before);
    expect(delta).toHaveLength(1);
    expect(delta[0].pairing).toBe("Non-Alc");
    expect(delta[0]).not.toHaveProperty("digestivos");
  });
});

describe("the anchor survives the database round trip", () => {
  it("reads the column opt-in", () => {
    expect(supabaseRowToCourse({ digestivo_before: true }).digestivo_before).toBe(true);
    expect(supabaseRowToCourse({}).digestivo_before).toBe(false);
    expect(supabaseRowToCourse({ digestivo_before: null }).digestivo_before).toBe(false);
  });

  it("writes it back as a real boolean", () => {
    expect(courseToSupabaseRow(course({ digestivo_before: true })).digestivo_before).toBe(true);
    expect(courseToSupabaseRow(course()).digestivo_before).toBe(false);
  });
});

describe("the admin ticket preview", () => {
  const courses = [
    { course_key: "danube", menu: { name: "Danube" } },
    { course_key: "buchtel", menu: { name: "Buchtel" }, digestivo_before: true },
  ];

  it("prints the digestivo line above the anchored course", () => {
    const html = generateKitchenTicketHTML(courses, null);
    expect(html).toContain("DIGESTIVO");
    expect(html.indexOf("DIGESTIVO")).toBeLessThan(html.lastIndexOf("Buchtel"));
    // Above the anchor, not above the course before it.
    expect(html.indexOf("Danube")).toBeLessThan(html.indexOf("DIGESTIVO"));
  });

  it("prints no digestivo line when no course is anchored", () => {
    const html = generateKitchenTicketHTML([{ course_key: "danube", menu: { name: "Danube" } }], null);
    expect(html).not.toContain("DIGESTIVO");
  });

  it("prints BTG for the sample's unpaired guest", () => {
    expect(generateKitchenTicketHTML(courses, null)).toContain("BTG");
  });
});

// ── Subcategories ────────────────────────────────────────────────────────────

const COFFEE = { id: 7, label: "Coffee", searchKey: "Coffee", type: "cocktail", variants: ["Espresso", "Cappuccino"] };
const GRAPPA = { id: 8, label: "Grappa", searchKey: "Grappa", type: "spirit" };
const product = (name) => ({ name, notes: "" });

describe("which subcategories a button offers", () => {
  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(digestivoVariants({ variants: [" Espresso ", "", "espresso", "Cappuccino", null] }))
      .toEqual(["Espresso", "Cappuccino"]);
  });

  it("treats a button with none, or a malformed list, as having none", () => {
    expect(digestivoVariants(GRAPPA)).toEqual([]);
    expect(digestivoVariants({ variants: "Espresso" })).toEqual([]);
    expect(digestivoVariants(null)).toEqual([]);
  });

  it("scrolls off → each subcategory → off, like the pairing button", () => {
    expect(digestivoCycleStates(COFFEE)).toEqual(["off", "Espresso", "Cappuccino"]);
  });

  it("keeps the plain on/off cycle for a button with no subcategories", () => {
    expect(digestivoCycleStates(GRAPPA)).toEqual(["off", "on"]);
  });
});

describe("what a pick is called", () => {
  it("carries the subcategory in the name, so the kitchen reads the choice", () => {
    expect(digestivoDisplayName("Coffee", "Espresso")).toBe("Coffee (Espresso)");
  });

  it("is just the product when there is no subcategory", () => {
    expect(digestivoDisplayName("Grappa", null)).toBe("Grappa");
    expect(digestivoDisplayName("Grappa", "  ")).toBe("Grappa");
  });
});

describe("scrolling a button on one seat", () => {
  const tap = (seat, opt, name) => ({ ...seat, digestivos: cycleSeatDigestivo(seat, opt, product(name), {}) });

  it("goes off → first subcategory → second → off", () => {
    let seat = { id: 1, digestivos: [] };
    expect(digestivoCurrentState(seat, COFFEE)).toBe("off");

    seat = tap(seat, COFFEE, "Coffee");
    expect(digestivoCurrentState(seat, COFFEE)).toBe("Espresso");
    expect(seat.digestivos.map(d => d.name)).toEqual(["Coffee (Espresso)"]);

    seat = tap(seat, COFFEE, "Coffee");
    expect(digestivoCurrentState(seat, COFFEE)).toBe("Cappuccino");
    expect(seat.digestivos.map(d => d.name)).toEqual(["Coffee (Cappuccino)"]);

    seat = tap(seat, COFFEE, "Coffee");
    expect(digestivoCurrentState(seat, COFFEE)).toBe("off");
    expect(seat.digestivos).toEqual([]);
  });

  it("replaces rather than stacks — changing your mind is not a second coffee", () => {
    let seat = { id: 1, digestivos: [] };
    seat = tap(seat, COFFEE, "Coffee");
    seat = tap(seat, COFFEE, "Coffee");
    expect(seat.digestivos).toHaveLength(1);
  });

  it("still toggles off → on → off for a button with no subcategories", () => {
    let seat = { id: 1, digestivos: [] };
    seat = tap(seat, GRAPPA, "Grappa");
    expect(digestivoCurrentState(seat, GRAPPA)).toBe("on");
    expect(seat.digestivos.map(d => d.name)).toEqual(["Grappa"]);
    seat = tap(seat, GRAPPA, "Grappa");
    expect(seat.digestivos).toEqual([]);
  });

  it("leaves the other buttons' picks alone", () => {
    let seat = { id: 1, digestivos: [] };
    seat = tap(seat, COFFEE, "Coffee");
    seat = tap(seat, GRAPPA, "Grappa");
    expect(seat.digestivos.map(d => d.name).sort()).toEqual(["Coffee (Espresso)", "Grappa"]);
    seat = tap(seat, COFFEE, "Coffee");   // Espresso → Cappuccino
    expect(seat.digestivos.map(d => d.name).sort()).toEqual(["Coffee (Cappuccino)", "Grappa"]);
  });

  it("names the next state so the button can advertise the tap", () => {
    const seat = { id: 1, digestivos: [] };
    expect(digestivoNextState(seat, COFFEE)).toBe("Espresso");
    expect(digestivoNextState(seat, GRAPPA)).toBe("on");
  });

  it("falls back to the button label when no catalogue product resolves", () => {
    const next = cycleSeatDigestivo({ id: 1, digestivos: [] }, COFFEE, null, {});
    expect(next[0].name).toBe("Coffee (Espresso)");
  });
});

describe("finding a seat's picks again", () => {
  it("matches on the button id, which survives a renamed product", () => {
    const entry = { name: "Anything", baseName: "Anything", digestivoId: 7 };
    expect(digestivoEntryMatchesOption(entry, COFFEE)).toBe(true);
    expect(digestivoEntryMatchesOption(entry, GRAPPA)).toBe(false);
  });

  it("falls back to the catalogue name for a pick stored before ids existed", () => {
    const legacy = { name: "Grappa" };
    expect(digestivoEntryMatchesOption(legacy, GRAPPA)).toBe(true);
  });

  it("reads a subcategory admin has since deleted as plain on, not a dead end", () => {
    // Otherwise the button would sit on a state its own cycle no longer
    // contains, and no number of taps would reach "off".
    const seat = { id: 1, digestivos: [{ name: "Coffee (Ristretto)", baseName: "Coffee", variant: "Ristretto", digestivoId: 7 }] };
    expect(digestivoCurrentState(seat, COFFEE)).toBe("on");
    expect(digestivoNextState(seat, COFFEE)).toBe("off");
    expect(cycleSeatDigestivo(seat, COFFEE, product("Coffee"), {})).toEqual([]);
  });
});

describe("subcategories reach the kitchen as distinct drinks", () => {
  it("does not collapse two subcategories of one button into a round", () => {
    const seat = {
      id: 1,
      digestivos: [
        { name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso" },
        { name: "Coffee (Cappuccino)", baseName: "Coffee", variant: "Cappuccino" },
      ],
    };
    expect(seatDigestivoNames(seat)).toEqual(["Coffee (Espresso)", "Coffee (Cappuccino)"]);
  });

  it("still collapses two of the SAME subcategory into one ×2", () => {
    const seat = {
      id: 1,
      digestivos: [
        { name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso" },
        { name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso" },
      ],
    };
    expect(seatDigestivoNames(seat)).toEqual(["Coffee (Espresso) ×2"]);
  });

  it("puts the chosen subcategory on the ticket line", () => {
    expect(digestivoTicketLine([
      { id: 1, digestivos: [{ name: "Coffee (Espresso)" }] },
      { id: 2, digestivos: [{ name: "Grappa" }] },
    ])).toBe("P1 Coffee (Espresso) · P2 Grappa");
  });
});
