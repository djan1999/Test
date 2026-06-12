import { describe, it, expect } from "vitest";
import {
  archiveEntryStats, aggregateInsights, historyGapsByMenuType,
  gapsForMenuType, findGuestHistory,
} from "../utils/archiveInsights.js";
import { estimateNextFire } from "../utils/fireCadence.js";

const COURSES = [
  { course_key: "amuse", position: 1, menu: { name: "Amuse" } },
  { course_key: "soup",  position: 2, menu: { name: "Soup" } },
  { course_key: "main",  position: 3, menu: { name: "Main" } },
];

const archivedTable = (over = {}) => ({
  id: 1,
  resName: "Smith",
  guests: 2,
  menuType: "Tasting",
  arrivedAt: "19:00",
  seats: [
    { id: 1, pairing: "Wine", aperitifs: ["x"], glasses: [], cocktails: [], spirits: [], beers: [] },
    { id: 2, pairing: "—",    aperitifs: [],    glasses: ["y"], cocktails: [], spirits: [], beers: [] },
  ],
  kitchenLog: {
    amuse: { firedAt: "19:20" }, // 20 min after arrival
    soup:  { firedAt: "19:45" }, // 25 min
    main:  { firedAt: "20:15" }, // 30 min
  },
  restrictions: [{ note: "gluten-free", pos: 1 }],
  ...over,
});

const entry = (over = {}) => ({
  date: "2026-06-01",
  label: "01.06.2026 – DINNER",
  state: { tables: [archivedTable()], menuCourses: COURSES },
  ...over,
});

describe("archiveEntryStats", () => {
  it("derives covers, gaps, pairing uptake and per-course gaps from a snapshot", () => {
    const s = archiveEntryStats(entry());
    expect(s.covers).toBe(2);
    expect(s.tableCount).toBe(1);
    expect(s.gaps).toEqual([20, 25, 30]);
    expect(s.medianGap).toBe(25);
    expect(s.seats).toBe(2);
    expect(s.paired).toBe(1);
    expect(s.courseGaps.get("Soup")).toEqual([25]);
    expect(s.courseGaps.get("Main")).toEqual([30]);
    expect(s.durations).toEqual([75]); // 19:00 → 20:15
  });

  it("survives empty/odd snapshots", () => {
    expect(archiveEntryStats({}).covers).toBe(0);
    expect(archiveEntryStats({ state: { tables: [{}] } }).gaps).toEqual([]);
  });
});

describe("aggregateInsights", () => {
  it("aggregates across services and ranks slowest courses with ≥3 samples", () => {
    const entries = [entry(), entry(), entry()];
    const agg = aggregateInsights(entries);
    expect(agg.services).toBe(3);
    expect(agg.totalCovers).toBe(6);
    expect(agg.avgCovers).toBe(2);
    expect(agg.medianGap).toBe(25);
    expect(agg.pairingPct).toBe(50);
    // Soup and Main each have 3 samples; Main (30) is slowest.
    expect(agg.slowestCourses[0]).toMatchObject({ name: "Main", medianGap: 30, samples: 3 });
  });

  it("returns null when there is nothing to aggregate", () => {
    expect(aggregateInsights([])).toBeNull();
    expect(aggregateInsights([{ state: { tables: [] } }])).toBeNull();
  });
});

describe("historyGapsByMenuType / gapsForMenuType", () => {
  it("pools gaps per menu type plus an overall pool", () => {
    const map = historyGapsByMenuType([entry()]);
    expect(map["tasting"]).toEqual([20, 25, 30]);
    expect(map["*"]).toEqual([20, 25, 30]);
  });

  it("falls back to the overall pool when the menu type is thin or unknown", () => {
    const map = historyGapsByMenuType([entry()]);
    expect(gapsForMenuType(map, "Short")).toEqual([20, 25, 30]); // unknown → "*"
    expect(gapsForMenuType(map, "Tasting")).toEqual([20, 25, 30]);
    expect(gapsForMenuType(null, "Tasting")).toEqual([]);
  });
});

describe("estimateNextFire with history seeding", () => {
  const courses = [
    { key: "amuse", firedAt: null },
    { key: "soup", firedAt: null },
  ];

  it("predicts the first course from arrival using history when nothing fired yet", () => {
    const est = estimateNextFire({
      table: { arrivedAt: "19:00" },
      courses,
      roomGaps: [],
      historyGaps: [20, 22, 24],
      now: new Date("2026-06-12T19:10:00"),
    });
    expect(est).toMatchObject({ basis: "history", cadenceMin: 22, dueInMin: 12 });
  });

  it("still returns null with no anchor and no data", () => {
    expect(estimateNextFire({ table: {}, courses, historyGaps: [20, 22, 24] })).toBeNull();
    expect(estimateNextFire({ table: { arrivedAt: "19:00" }, courses, historyGaps: [20] })).toBeNull();
  });

  it("prefers the table's own rhythm over history", () => {
    const fired = [
      { key: "amuse", firedAt: "19:20" },
      { key: "soup", firedAt: "19:40" },
      { key: "main", firedAt: null },
    ];
    const est = estimateNextFire({
      table: { arrivedAt: "19:00" },
      courses: fired,
      historyGaps: [60, 60, 60],
      now: new Date("2026-06-12T19:50:00"),
    });
    expect(est.basis).toBe("table");
    expect(est.cadenceMin).toBe(20);
  });
});

describe("findGuestHistory", () => {
  it("matches by partial name, newest entries first, with visit summary", () => {
    const visits = findGuestHistory("smi", [entry()]);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      name: "Smith",
      guests: 2,
      menuType: "Tasting",
      pairings: ["Wine"],
      restrictions: ["gluten-free"],
      birthday: false,
      drinks: 2,
    });
  });

  it("requires at least 3 characters and respects the limit", () => {
    expect(findGuestHistory("sm", [entry()])).toEqual([]);
    const many = [entry(), entry(), entry(), entry()];
    expect(findGuestHistory("smith", many, { limit: 2 })).toHaveLength(2);
  });
});
