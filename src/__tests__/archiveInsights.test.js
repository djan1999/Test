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

  it("does not double-count a party seated across grouped tables", () => {
    // A 4-top split across T02+T03: the reconcile stamps guests=4 on BOTH
    // members and seats live on both. Raw summing would report 8 covers / 2
    // tables; merged it must be 4 covers / 1 table.
    const groupedEntry = {
      date: "2026-06-12",
      label: "x",
      state: {
        menuCourses: COURSES,
        tables: [
          { id: 2, resName: "Group", guests: 4, menuType: "Tasting", tableGroup: [2, 3],
            seats: [{ id: 1, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
                    { id: 2, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] }],
            kitchenLog: {} },
          { id: 3, resName: "Group", guests: 4, menuType: "Tasting", tableGroup: [2, 3],
            seats: [{ id: 1, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
                    { id: 2, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] }],
            kitchenLog: {} },
        ],
      },
    };
    const s = archiveEntryStats(groupedEntry);
    expect(s.covers).toBe(4);
    expect(s.tableCount).toBe(1);
    expect(s.seats).toBe(4); // 2+2 real seats, counted once
  });
});

// The archive's kitchen timings live on the TABLE (kitchenLog). Menu context
// can go missing in three real ways, and each one used to erase those timings.
describe("kitchen timings survive thin menu context", () => {
  it("keeps the night's timings when the entry was filed with NO menu snapshot", () => {
    // The rollover auto-end (and the store's single-live supersede) files a
    // service without a snapshot. Reading courses from the menu alone left
    // such a night with zero gaps, zero durations and no cadence history —
    // the fire times were in the store the whole time.
    const noMenu = { date: "2026-06-02", label: "02.06.2026 – DINNER", state: { tables: [archivedTable()], menuCourses: [] } };
    const s = archiveEntryStats(noMenu);
    expect(s.gaps).toEqual([20, 25, 30]);
    expect(s.medianGap).toBe(25);
    expect(s.durations).toEqual([75]);
    expect(historyGapsByMenuType([noMenu])["tasting"]).toEqual([20, 25, 30]);

    // Course names come from the raw keys on their own, and from the live menu
    // when the caller passes it — so those samples aggregate with every other
    // night's instead of splitting into a second name.
    expect([...archiveEntryStats(noMenu).courseGaps.keys()]).toEqual(["amuse", "soup", "main"]);
    const named = archiveEntryStats(noMenu, { menuCourses: COURSES });
    expect(named.courseGaps.get("Soup")).toEqual([25]);
    expect(named.courseGaps.get("Main")).toEqual([30]);
  });

  it("keeps the timing of a course the menu no longer shows", () => {
    // `soup` was retired since that night (is_active = false) and `cake` is a
    // celebration dish whose ordered marker isn't in the snapshot — both fired
    // and both were dropped, which also cut the night's duration to 20 min.
    const menu = [
      { course_key: "amuse", position: 1, menu: { name: "Amuse" } },
      { course_key: "soup", position: 2, menu: { name: "Soup" }, is_active: false },
      { course_key: "cake", position: 3, menu: { name: "Cake" }, course_category: "celebration", optional_flag: "cake" },
    ];
    const t = archivedTable({ kitchenLog: {
      amuse: { firedAt: "19:20" }, soup: { firedAt: "19:45" }, cake: { firedAt: "20:15" },
    } });
    const s = archiveEntryStats({ date: "2026-06-03", label: "x", state: { tables: [t], menuCourses: menu } });
    expect(s.gaps).toEqual([20, 25, 30]);
    expect(s.durations).toEqual([75]);
    expect(s.courseGaps.get("Soup")).toEqual([25]);
    expect(s.courseGaps.get("Cake")).toEqual([30]);
  });

  it("names an off-menu fire from the table's own kitchen override, then the key", () => {
    const t = archivedTable({
      kitchenLog: { amuse: { firedAt: "19:20" }, ghost: { firedAt: "19:50" } },
      kitchenCourseNotes: { ghost: { name: "Chef's Extra" } },
    });
    const s = archiveEntryStats({ date: "2026-06-04", label: "x", state: { tables: [t], menuCourses: COURSES } });
    expect(s.courseGaps.get("Chef's Extra")).toEqual([30]);
  });

  it("ignores a logged course that never fired", () => {
    const t = archivedTable({ kitchenLog: { amuse: { firedAt: "19:20" }, dessert: { firedAt: null } } });
    const s = archiveEntryStats({ date: "2026-06-05", label: "x", state: { tables: [t], menuCourses: [] } });
    expect(s.gaps).toEqual([20]); // arrival → amuse only
    expect([...s.courseGaps.keys()]).toEqual(["amuse"]); // no phantom "dessert"
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

describe("no-shows in the archive", () => {
  it("a never-arrived templated reservation is not counted as covers or pairing seats", () => {
    const e = {
      date: "2026-06-12", label: "x",
      state: {
        menuCourses: [],
        tables: [
          // no-show: templated booking, blank seats, no arrival/kitchen markers
          { id: 4, resName: "Ghost", resTime: "19:00", guests: 2, tableGroup: [],
            seats: [{ id: 1, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
                    { id: 2, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] }] },
          // real party
          { id: 5, resName: "Real", guests: 2, arrivedAt: "19:10", tableGroup: [],
            seats: [{ id: 1, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] },
                    { id: 2, aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [] }] },
        ],
      },
    };
    const s = archiveEntryStats(e);
    expect(s.covers).toBe(2);      // Ghost's 2 not counted
    expect(s.seats).toBe(2);       // pairing denominator = real covers only
    expect(s.paired).toBe(1);
  });
});
