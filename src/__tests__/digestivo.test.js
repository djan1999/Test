import { describe, it, expect } from "vitest";
import {
  courseAnchorsDigestivo,
  digestivoVariants,
  digestivoMenuParts,
  digestivoVariantOptions,
  digestivoVariantRows,
  digestivoVariantFor,
  digestivoOptionFromItem,
  resolveDigestivoProduct,
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

describe("the category names no drink — its subcategories do", () => {
  // "Coffee" is not something the bar can pour; "Espresso – Banibeans" is. So
  // the group carries no link of its own and the product comes from whichever
  // subcategory was chosen. A group that resolved itself is how the Tea button
  // ended up holding a champagne.
  const COFFEES = [
    { id: 31, name: "Espresso", notes: "Espresso, Banibeans" },
    { id: 32, name: "Nestor Lasso Ají Decaf", notes: "Filter, BANI BEANS" },
  ];
  const CELLAR = [{ id: "w1", name: "Coteaux Champenois", producer: "Adrien Renoir", byGlass: true }];
  const catalogs = { wines: CELLAR, cocktails: [], spirits: [], beers: [], teas: [], coffees: COFFEES };

  const GROUP = {
    id: 7, label: "Coffee", searchKey: "Coffee", type: "wine",
    variants: [
      { label: "Espresso", type: "coffee", searchKey: "Espresso", linkedKey: "coffee|Espresso" },
      { label: "Decaf", type: "coffee", searchKey: "Nestor Lasso Ají Decaf", linkedKey: "coffee|Nestor Lasso Ají Decaf" },
    ],
  };

  it("reads a subcategory's own link", () => {
    expect(resolveDigestivoProduct(GROUP, "Espresso", catalogs)?.id).toBe(31);
    expect(resolveDigestivoProduct(GROUP, "Decaf", catalogs)?.id).toBe(32);
  });

  it("never falls back to the category's link, however it is configured", () => {
    // GROUP still carries type "wine" and searchKey "Coffee" from before the
    // subcategories existed. Consulting either is what has to stay impossible.
    expect(resolveDigestivoProduct(GROUP, null, catalogs)).toBeNull();
    expect(resolveDigestivoProduct(GROUP, "Nonexistent", catalogs)).toBeNull();
    const unlinked = { ...GROUP, variants: [{ label: "Espresso" }] };
    expect(resolveDigestivoProduct(unlinked, "Espresso", catalogs)).toBeNull();
  });

  it("still links directly when the button has no subcategories at all", () => {
    // A Grappa button is a button, not a category — it reaches its own drink.
    const plain = { id: 8, label: "Espresso", searchKey: "Espresso", type: "coffee" };
    expect(resolveDigestivoProduct(plain, null, catalogs)?.id).toBe(31);
  });

  it("reads a config written before subcategories carried links", () => {
    const legacy = { id: 7, label: "Coffee", variants: ["Espresso", " Decaf ", "", "espresso"] };
    expect(digestivoVariants(legacy)).toEqual(["Espresso", "Decaf"]);
    expect(digestivoVariantOptions(legacy)[0]).toEqual({ label: "Espresso" });
    // It has no link yet, so it resolves to nothing rather than to a guess.
    expect(resolveDigestivoProduct(legacy, "Espresso", catalogs)).toBeNull();
  });

  it("hands the editor every row, blank ones included", () => {
    // The floor's view drops a blank row; a form cannot, or a row could never
    // be added or renamed — it passes through blank on the way.
    const mid = { id: 7, label: "Coffee", variants: [
      { label: "Espresso", type: "coffee" },
      { label: "", type: "coffee" },
      { label: "espresso", type: "coffee" },
    ] };
    expect(digestivoVariantRows(mid).map(v => v.label)).toEqual(["Espresso", "", "espresso"]);
    expect(digestivoVariants(mid)).toEqual(["Espresso"]);
  });

  it("leaves a half-typed label exactly as typed", () => {
    // Trimming here would eat the space between two words as it is typed.
    const typing = { id: 7, label: "Coffee", variants: [{ label: "Cafe " }] };
    expect(digestivoVariantRows(typing)[0].label).toBe("Cafe ");
    expect(digestivoVariantOptions(typing)[0].label).toBe("Cafe");
  });

  it("reads legacy string rows for the editor too", () => {
    const legacy = { id: 7, label: "Coffee", variants: ["Espresso", ""] };
    expect(digestivoVariantRows(legacy)).toEqual([{ label: "Espresso" }, { label: "" }]);
    expect(digestivoVariantRows({ id: 7, label: "Grappa" })).toEqual([]);
  });

  it("finds a subcategory by label, case and padding forgiven", () => {
    expect(digestivoVariantFor(GROUP, "  espresso ")?.linkedKey).toBe("coffee|Espresso");
    expect(digestivoVariantFor(GROUP, "latte")).toBeNull();
    expect(digestivoVariantFor(GROUP, "")).toBeNull();
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

describe("what the kitchen reads", () => {
  // The pass pours a product. It used to be handed the menu heading with the
  // subcategory in brackets — "Coffee (Decaf)" — which names nothing on a shelf.
  const decaf = {
    id: 32, name: "Nestor Lasso Ají Decaf (Decaf)", notes: "Filter, BANI BEANS",
    baseName: "Nestor Lasso Ají Decaf", linkedName: "Nestor Lasso Ají Decaf",
    variant: "Decaf", digestivoCategory: "Coffee", digestivoId: 7,
  };
  const espresso = { ...decaf, id: 31, name: "Espresso (Espresso)", linkedName: "Espresso", baseName: "Espresso", variant: "Espresso" };

  it("prints the linked product alone", () => {
    expect(seatDigestivoNames({ id: 1, digestivos: [decaf] })).toEqual(["Nestor Lasso Ají Decaf"]);
  });

  it("falls back to the subcategory when the button links nothing", () => {
    // No product exists to name, and the subcategory is what the guest chose —
    // more use to the pass than the category it sits under.
    const unlinked = {
      name: "Tea (Chamomile)", notes: "", __cocktail: true,
      baseName: "Tea", variant: "Chamomile", digestivoCategory: "Tea", digestivoId: 9,
    };
    expect(seatDigestivoNames({ id: 1, digestivos: [unlinked] })).toEqual(["Chamomile"]);
  });

  it("does not collapse two subcategories of one button into a round", () => {
    expect(seatDigestivoNames({ id: 1, digestivos: [decaf, espresso] }))
      .toEqual(["Nestor Lasso Ají Decaf", "Espresso"]);
  });

  it("still collapses two of the SAME subcategory into one ×2", () => {
    expect(seatDigestivoNames({ id: 1, digestivos: [decaf, decaf] }))
      .toEqual(["Nestor Lasso Ají Decaf ×2"]);
  });

  it("puts the product on the ticket line", () => {
    expect(digestivoTicketLine([
      { id: 1, digestivos: [decaf] },
      { id: 2, digestivos: [{ id: 5, name: "Grappa Williams", baseName: "Grappa Williams", linkedName: "Grappa Williams" }] },
    ])).toBe("P1 Nestor Lasso Ají Decaf · P2 Grappa Williams");
  });

  it("reads an entry stored before a pick recorded its product", () => {
    // The catalogue row was spread in, so its id is the tell: an id means
    // baseName is the product, none means baseName is the category.
    const oldLinked = { id: 31, name: "Espresso (Espresso)", baseName: "Espresso", variant: "Espresso" };
    const oldUnlinked = { name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso", __cocktail: true };
    expect(seatDigestivoNames({ id: 1, digestivos: [oldLinked] })).toEqual(["Espresso"]);
    expect(seatDigestivoNames({ id: 1, digestivos: [oldUnlinked] })).toEqual(["Espresso"]);
  });
});

describe("what the menu prints", () => {
  it("names the subcategory and describes it with its category", () => {
    const entry = digestivoEntry(
      { id: 32, name: "Nestor Lasso Ají Decaf", notes: "Filter, BANI BEANS", category: "coffee" },
      { baseName: "Nestor Lasso Ají Decaf", variant: "Decaf", optionId: 7, category: "Coffee" });
    expect(digestivoMenuParts(entry)).toEqual({ title: "Decaf", sub: "Coffee" });
  });

  it("takes the button's category, not the catalogue row's own", () => {
    // A beverage row carries category "coffee"; printing that under the guest's
    // name is why the pick records the button's label under its own key.
    const entry = digestivoEntry(
      { id: 31, name: "Espresso", notes: "Espresso, Banibeans", category: "coffee" },
      { baseName: "Espresso", variant: "Espresso", optionId: 7, category: "Coffee" });
    expect(entry.category).toBe("coffee");
    expect(digestivoMenuParts(entry).sub).toBe("Coffee");
  });

  it("prints one line when the pick has no subcategory", () => {
    const searched = digestivoEntry({ id: 5, name: "Grappa Williams", notes: "" });
    expect(digestivoMenuParts(searched)).toEqual({ title: "Grappa Williams", sub: "" });
  });

  it("does not print a category that only repeats the name", () => {
    const entry = digestivoEntry({ name: "Grappa", notes: "", __cocktail: true },
      { baseName: "Grappa", variant: "Grappa", optionId: 3, category: "Grappa" });
    expect(digestivoMenuParts(entry)).toEqual({ title: "Grappa", sub: "" });
  });
});

describe("a configured button, as the service surfaces receive it", () => {
  // The bug this pins: the caller that built this inline stringified each
  // subcategory. Once subcategories became objects carrying their own link,
  // String(v) made every one of them "[object Object]" — identical, so the
  // de-duplication kept exactly one, and a five-coffee button offered a single
  // nonsense row. Subcategories must be handed on untouched.
  it("passes linked subcategories through without flattening them", () => {
    const item = {
      id: 8, label: "Grappa", searchKey: "Grappa", type: "wine", enabled: true,
      variants: [
        { label: "Williams", type: "spirit", linkedKey: "spirit|Viljamovka – small batch – Berke" },
        { label: "Plum", type: "spirit", linkedKey: "spirit|Plum – small batch – Berke" },
      ],
    };
    const opt = digestivoOptionFromItem(item);
    expect(digestivoVariants(opt)).toEqual(["Williams", "Plum"]);
    expect(digestivoVariantFor(opt, "Plum").linkedKey).toBe("spirit|Plum – small batch – Berke");
    expect(JSON.stringify(opt)).not.toContain("object Object");
  });

  it("still passes the older plain-string subcategories through", () => {
    const opt = digestivoOptionFromItem({ id: 7, label: "Coffee", variants: ["Espresso", "Decaf"] });
    expect(digestivoVariants(opt)).toEqual(["Espresso", "Decaf"]);
  });

  it("carries the button's own identity, and an empty list when it has none", () => {
    const opt = digestivoOptionFromItem({ id: 9, label: "Amaro" });
    expect(opt).toMatchObject({ id: 9, label: "Amaro", searchKey: "Amaro", type: "wine", variants: [] });
  });
});
