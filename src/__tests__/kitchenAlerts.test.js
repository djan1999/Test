import { describe, it, expect } from "vitest";
import { kitchenSnapshot, kitchenDelta, hasKitchenUpdate, mergeKitchenAlert, setCourseRestrictions } from "../utils/kitchenAlerts.js";

// Minimal optional-extra defs (beetroot, cheese) and a passthrough pairing fn
const EXTRAS = [
  { key: "beetroot", id: "beetroot", name: "Beetroot" },
  { key: "cheese", id: "cheese", name: "Cheese" },
];
const seat = (id, over = {}) => ({ id, gender: null, pairing: "—", extras: {}, ...over });
const ordered = (extra = {}) => ({ ordered: true, ...extra });

// Extras defs carrying their course row (as optionalExtrasFromCourses builds
// them) — beetroot has a nut variant note, so a nut-allergy seat's call must
// reach the kitchen as a modified plate.
const BEET_COURSE = {
  course_key: "beetroot",
  menu: { name: "Beetroot", sub: "" },
  restrictions: { nut_note: "no hazelnut oil" },
};
const EXTRAS_WITH_COURSE = [
  { key: "beetroot", id: "beetroot", name: "Beetroot", course: BEET_COURSE },
  { key: "cheese", id: "cheese", name: "Cheese", course: { course_key: "cheese", menu: { name: "Cheese", sub: "" }, restrictions: {} } },
];
const NUT_P1 = [{ pos: 1, note: "nut" }];

describe("kitchenSnapshot", () => {
  it("captures pairing and ordered extras per seat", () => {
    const seats = [
      seat(1, { pairing: "Wine", extras: { beetroot: ordered() } }),
      seat(2, { pairing: "—", extras: {} }),
    ];
    const snap = kitchenSnapshot(seats, EXTRAS, []);
    expect(snap[1].pairing).toBe("Wine");
    expect(snap[1].extras.map((e) => e.key)).toEqual(["beetroot"]);
    expect(snap[2].pairing).toBe(null); // "—" normalises to null
    expect(snap[2].extras).toEqual([]);
  });

  it("ignores extras that aren't ordered", () => {
    const snap = kitchenSnapshot([seat(1, { extras: { beetroot: { ordered: false } } })], EXTRAS, []);
    expect(snap[1].extras).toEqual([]);
  });

  it("an extra called for a restricted seat carries the dish's modification", () => {
    const seats = [
      seat(1, { extras: { beetroot: ordered() } }), // nut allergy
      seat(2, { extras: { beetroot: ordered() } }), // no restriction
    ];
    const snap = kitchenSnapshot(seats, EXTRAS_WITH_COURSE, [], NUT_P1);
    expect(snap[1].extras[0].restriction).toBe("NO HAZELNUT OIL");
    expect(snap[2].extras[0].restriction).toBe(null); // the allergy never leaks to the other chair
  });

  it("a restriction that doesn't touch the dish adds no modification", () => {
    // cheese has no nut variant → the nut guest's cheese call stays plain
    const snap = kitchenSnapshot(
      [seat(1, { extras: { cheese: ordered() } })], EXTRAS_WITH_COURSE, [], NUT_P1);
    expect(snap[1].extras[0].restriction).toBe(null);
  });

  it("the per-table text override rewrites the alert's restriction too", () => {
    const kcNotes = { beetroot: { modOverrides: { "NO HAZELNUT OIL": "NO HAZELNUT OIL, EXTRA SAUCE" } } };
    const snap = kitchenSnapshot(
      [seat(1, { extras: { beetroot: ordered() } })], EXTRAS_WITH_COURSE, [], NUT_P1, kcNotes);
    expect(snap[1].extras[0].restriction).toBe("NO HAZELNUT OIL, EXTRA SAUCE");
  });
});

describe("kitchenDelta", () => {
  it("returns everything on the first send (empty baseline)", () => {
    const cur = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(cur, {});
    expect(delta).toHaveLength(1);
    expect(delta[0].pairing).toBe("Wine");
    expect(delta[0].extras.map((e) => e.key)).toEqual(["beetroot"]);
  });

  it("sends nothing when nothing changed", () => {
    const cur = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    expect(kitchenDelta(cur, cur)).toEqual([]);
    expect(hasKitchenUpdate(cur, cur)).toBe(false);
  });

  it("sends only the newly added extra, not the previously sent one", () => {
    const base = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const next = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered(), cheese: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta).toHaveLength(1);
    // beetroot was already acknowledged → only cheese is new
    expect(delta[0].extras.map((e) => e.key)).toEqual(["cheese"]);
    // pairing unchanged → omitted so the overlay doesn't re-announce it
    expect(delta[0].pairing).toBe(null);
  });

  it("flags a pairing change without repeating already-sent extras", () => {
    const base = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const next = kitchenSnapshot([seat(1, { pairing: "Non-Alc", extras: { beetroot: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta).toHaveLength(1);
    expect(delta[0].pairing).toBe("Non-Alc");
    expect(delta[0].extras).toEqual([]); // beetroot already known
  });

  it("only includes the seat that changed", () => {
    const base = kitchenSnapshot([
      seat(1, { extras: { beetroot: ordered() } }),
      seat(2, { extras: {} }),
    ], EXTRAS, []);
    const next = kitchenSnapshot([
      seat(1, { extras: { beetroot: ordered() } }),
      seat(2, { extras: { cheese: ordered() } }),
    ], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta.map((s) => s.id)).toEqual([2]);
  });

  it("treats a missing baseline (null) as nothing-sent-yet", () => {
    const cur = kitchenSnapshot([seat(1, { extras: { beetroot: ordered() } })], EXTRAS, []);
    expect(hasKitchenUpdate(cur, null ?? {})).toBe(true);
  });

  it("an allergy recorded AFTER the dish was sent re-sends it with the restriction", () => {
    // The plate may already be on the line — this delta is exactly the update
    // the kitchen must hear about.
    const seats = [seat(1, { extras: { beetroot: ordered() } })];
    const base = kitchenSnapshot(seats, EXTRAS_WITH_COURSE, [], []);
    const next = kitchenSnapshot(seats, EXTRAS_WITH_COURSE, [], NUT_P1);
    const delta = kitchenDelta(next, base);
    expect(delta).toHaveLength(1);
    expect(delta[0].extras.map((e) => e.key)).toEqual(["beetroot"]);
    expect(delta[0].extras[0].restriction).toBe("NO HAZELNUT OIL");
  });
});

describe("mergeKitchenAlert", () => {
  const deltaAlert = (over = {}) => ({
    timestamp: "2026-08-20T18:00:00.000Z",
    tableName: "NOVAK",
    seats: [{ id: 1, gender: null, pairing: null, pairingSharedWith: null,
      extras: [{ key: "cheese", name: "Cheese", pairing: null, sharedWith: null }] }],
    confirmed: false,
    snapshot: { 1: { pairing: null, extras: [{ key: "cheese" }] } },
    ...over,
  });
  const setAlert = (over = {}) => ({
    timestamp: "2026-08-20T18:05:00.000Z",
    tableName: "NOVAK",
    seats: [],
    confirmed: false,
    course: { key: "c2", index: 2, name: "Brioche", at: "18:05" },
    ...over,
  });

  it("passes the new alert through when nothing is pending", () => {
    const next = setAlert();
    expect(mergeKitchenAlert(null, next)).toBe(next);
    expect(mergeKitchenAlert(undefined, next)).toBe(next);
  });

  it("passes the new alert through when the pending one is confirmed", () => {
    const next = setAlert();
    expect(mergeKitchenAlert(deltaAlert({ confirmed: true }), next)).toBe(next);
  });

  it("a SET landing on a pending cheese call keeps BOTH in the popup", () => {
    const merged = mergeKitchenAlert(deltaAlert(), setAlert());
    // the set course arrived
    expect(merged.course).toEqual({ key: "c2", index: 2, name: "Brioche", at: "18:05" });
    // the cheese call survived
    expect(merged.seats).toHaveLength(1);
    expect(merged.seats[0].extras.map((e) => e.key)).toEqual(["cheese"]);
    // the delta's snapshot survived for the kitchen CONFIRM ack
    expect(merged.snapshot).toEqual(deltaAlert().snapshot);
    expect(merged.confirmed).toBe(false);
  });

  it("a cheese call landing on a pending SET keeps the course banner", () => {
    const merged = mergeKitchenAlert(setAlert(), deltaAlert({ timestamp: "2026-08-20T18:06:00.000Z" }));
    expect(merged.course).toEqual(setAlert().course);
    expect(merged.seats[0].extras.map((e) => e.key)).toEqual(["cheese"]);
    expect(merged.timestamp).toBe("2026-08-20T18:06:00.000Z");
  });

  it("merges per-seat: same seat's extras union by key, later wins", () => {
    const pending = deltaAlert();
    const next = deltaAlert({
      seats: [
        { id: 1, gender: "Mr", pairing: "Wine", pairingSharedWith: null,
          extras: [{ key: "cheese", name: "Cheese", pairing: "Wine", sharedWith: null },
                   { key: "beetroot", name: "Beetroot", pairing: null, sharedWith: null }] },
        { id: 2, gender: null, pairing: "Non-Alc", pairingSharedWith: null, extras: [] },
      ],
    });
    const merged = mergeKitchenAlert(pending, next);
    expect(merged.seats).toHaveLength(2);
    const s1 = merged.seats.find((s) => s.id === 1);
    expect(s1.extras.map((e) => e.key).sort()).toEqual(["beetroot", "cheese"]);
    expect(s1.extras.find((e) => e.key === "cheese").pairing).toBe("Wine"); // later wins
    expect(s1.pairing).toBe("Wine");
  });

  it("null pairing in the newer delta means unchanged — the pending one survives", () => {
    const pending = deltaAlert({ seats: [{ id: 1, gender: null, pairing: "Wine", pairingSharedWith: null, extras: [] }] });
    const next = deltaAlert({ seats: [{ id: 1, gender: null, pairing: null, pairingSharedWith: null,
      extras: [{ key: "beetroot", name: "Beetroot", pairing: null, sharedWith: null }] }] });
    const merged = mergeKitchenAlert(pending, next);
    expect(merged.seats[0].pairing).toBe("Wine");
    expect(merged.seats[0].extras.map((e) => e.key)).toEqual(["beetroot"]);
  });

  it("a second SET replaces the course but keeps pending seats", () => {
    const first = mergeKitchenAlert(deltaAlert(), setAlert());
    const second = mergeKitchenAlert(first, setAlert({
      course: { key: "c3", index: 3, name: "Cheese course", at: "18:40" },
      timestamp: "2026-08-20T18:40:00.000Z",
    }));
    expect(second.course.key).toBe("c3");
    expect(second.seats[0].extras.map((e) => e.key)).toEqual(["cheese"]);
  });

  it("a CANCELLED pairing does not resurrect the pending one (pairingChanged)", () => {
    // real delta: P1's pairing goes Wine → '—' — kitchenDelta emits
    // pairing:null WITH pairingChanged:true, and the merge must honor it
    const base = kitchenSnapshot([seat(1, { pairing: "Wine" })], EXTRAS, []);
    const cur = kitchenSnapshot([seat(1, { pairing: "—" })], EXTRAS, []);
    const cancelSeats = kitchenDelta(cur, base);
    expect(cancelSeats).toHaveLength(1);
    expect(cancelSeats[0].pairing).toBe(null);
    expect(cancelSeats[0].pairingChanged).toBe(true);
    const pending = deltaAlert({ seats: [{ id: 1, gender: null, pairing: "Wine", pairingSharedWith: null, extras: [] }] });
    const merged = mergeKitchenAlert(pending, deltaAlert({ seats: cancelSeats, snapshot: cur }));
    expect(merged.seats[0].pairing).toBe(null); // Wine stays cancelled
  });

  it("an extras-only delta (pairingChanged false) still keeps the pending pairing", () => {
    const base = kitchenSnapshot([seat(1, { pairing: "Wine" })], EXTRAS, []);
    const cur = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { cheese: ordered() } })], EXTRAS, []);
    const extraSeats = kitchenDelta(cur, base);
    expect(extraSeats[0].pairingChanged).toBe(false);
    const pending = deltaAlert({ seats: [{ id: 1, gender: null, pairing: "Wine", pairingSharedWith: null, extras: [] }] });
    const merged = mergeKitchenAlert(pending, deltaAlert({ seats: extraSeats, snapshot: cur }));
    expect(merged.seats[0].pairing).toBe("Wine"); // unchanged → survives
    expect(merged.seats[0].extras.map((e) => e.key)).toEqual(["cheese"]);
  });

  it("a legacy {beet,cheese} pending seat keeps its items through a merge", () => {
    const legacyPending = deltaAlert({
      seats: [{ id: 2, gender: null, beet: { pairing: "Wine" }, cheese: {} }], // pre-array format
      snapshot: undefined,
    });
    const merged = mergeKitchenAlert(legacyPending, setAlert());
    expect(merged.course).toBeTruthy();
    const s2 = merged.seats.find((s) => s.id === 2);
    expect(Array.isArray(s2.extras)).toBe(true);
    expect(s2.extras.map((e) => e.key).sort()).toEqual(["beetroot", "cheese"]);
    expect(s2.beet).toBeUndefined(); // translated, not duplicated
  });
});

describe("setCourseRestrictions — a SET popup names the dietaries that change the course", () => {
  const SQUASH = { course_key: "squash", menu: { name: "Squash", sub: "" }, restrictions: { veg_note: "potato cracklings" } };
  const visible = { key: "squash", index: 5, name: "Squash", rawCourse: SQUASH };
  const seats = [seat(1), seat(2), seat(3)];

  it("lists the modification per chair, in seat order", () => {
    const out = setCourseRestrictions(visible, seats, [{ pos: 2, note: "veg" }]);
    expect(out.restrictions).toHaveLength(1);
    expect(out.restrictions[0].pos).toBe(2);
    expect(out.restrictions[0].mod.toLowerCase()).toContain("potato cracklings");
    expect(out.unassignedRestrictions).toEqual([]);
  });

  it("ignores dietaries the course has no variant for", () => {
    expect(setCourseRestrictions(visible, seats, [{ pos: 1, note: "nut" }]).restrictions).toEqual([]);
  });

  it("applies the per-table text override, as the ticket does", () => {
    const base = setCourseRestrictions(visible, seats, [{ pos: 2, note: "veg" }]).restrictions[0].mod;
    const out = setCourseRestrictions(visible, seats, [{ pos: 2, note: "veg" }],
      { squash: { modOverrides: { [base]: "CRACKLINGS, NO BUTTER" } } });
    expect(out.restrictions[0].mod).toBe("CRACKLINGS, NO BUTTER");
  });

  it("flags an unassigned dietary instead of pinning it to a chair", () => {
    const out = setCourseRestrictions(visible, seats, [{ pos: null, note: "veg" }]);
    expect(out.restrictions).toEqual([]);
    expect(out.unassignedRestrictions).toHaveLength(1);
    expect(out.unassignedRestrictions[0]).toMatch(/Vegetarian: /);
  });

  it("respects a kitchen layout that hides restrictions on the course", () => {
    const hidden = { ...visible, kitchenItem: { showRestrictions: false } };
    expect(setCourseRestrictions(hidden, seats, [{ pos: 2, note: "veg" }]).restrictions).toEqual([]);
  });

  it("survives a Send merging into the pending SET alert", () => {
    const course = { key: "squash", index: 5, name: "Squash", restrictions: [{ pos: 2, mod: "POTATO CRACKLINGS" }], unassignedRestrictions: [] };
    const merged = mergeKitchenAlert({ timestamp: "t0", seats: [], confirmed: false, course }, { timestamp: "t1", seats: [], confirmed: false });
    expect(merged.course.restrictions).toEqual(course.restrictions);
  });
});
