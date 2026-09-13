import { describe, it, expect } from "vitest";
import {
  courseAnchorsDigestivo,
  digestivoAnchorKeys,
  isDigestivoAnchor,
  seatDigestivoNames,
  digestivoSeatOrders,
  digestivoTicketLine,
  digestivoCount,
} from "../utils/digestivo.js";
import { makeSeats } from "../utils/tableHelpers.js";
import { kitchenSnapshot, kitchenDelta, mergeKitchenAlert } from "../utils/kitchenAlerts.js";
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

describe("the kitchen hears about the digestivo on Send", () => {
  const snap = (digestivos) => kitchenSnapshot([{ id: 1, extras: {}, pairing: "Wine", digestivos }]);

  it("carries the picks as display names on the snapshot", () => {
    expect(snap([{ name: "Espresso" }, { name: "Espresso" }])[1].digestivos).toEqual(["Espresso ×2"]);
  });

  it("sends a delta the first time a guest orders one", () => {
    const delta = kitchenDelta(snap([{ name: "Espresso" }]), snap([]));
    expect(delta).toHaveLength(1);
    expect(delta[0].digestivos).toEqual(["Espresso"]);
    expect(delta[0].digestivosChanged).toBe(true);
  });

  it("sends a delta when the round grows", () => {
    const delta = kitchenDelta(snap([{ name: "Espresso" }, { name: "Espresso" }]), snap([{ name: "Espresso" }]));
    expect(delta[0].digestivos).toEqual(["Espresso ×2"]);
  });

  it("sends a delta when the order is cancelled, flagged so the popup can tell", () => {
    const delta = kitchenDelta(snap([]), snap([{ name: "Espresso" }]));
    expect(delta[0].digestivos).toEqual([]);
    expect(delta[0].digestivosChanged).toBe(true);
  });

  it("sends nothing when the digestivo has not moved", () => {
    const same = snap([{ name: "Grappa" }]);
    expect(kitchenDelta(same, same)).toEqual([]);
  });

  it("keeps a pending popup's digestivo when a later SET alert says nothing about it", () => {
    const pending = {
      seats: [{ id: 1, digestivos: ["Espresso"], digestivosChanged: true, extras: [] }],
      confirmed: false,
    };
    const merged = mergeKitchenAlert(pending, { course: { index: 4, name: "Buchtel" }, seats: [] });
    expect(merged.seats[0].digestivos).toEqual(["Espresso"]);
  });

  it("lets a cancellation overwrite the pending popup rather than resurrecting the drink", () => {
    const pending = {
      seats: [{ id: 1, digestivos: ["Espresso"], digestivosChanged: true, extras: [] }],
      confirmed: false,
    };
    const merged = mergeKitchenAlert(pending, {
      seats: [{ id: 1, digestivos: [], digestivosChanged: true, extras: [] }],
    });
    expect(merged.seats[0].digestivos).toEqual([]);
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
