// ── Board ↔ reservation invariants under random op sequences ─────────────────
//
// Property-based check of the rules that unit tests kept missing because each
// one only exercised a single function: the 04.07 incidents came from the
// INTERACTION of move/swap repoints with the reconcile. Here a seeded PRNG
// drives random sequences of the REAL production transforms —
// moveTableRows/swapTableRows + repointReservation (utils/tableHelpers) and
// reconcileTables (utils/reconcile) — and asserts the invariants catalogued in
// docs/INVARIANTS.md after every step:
//
//   I1  table_id ∈ reservationTableIds(data, table_id) for every reservation
//       (no table_id ↔ tableGroup desync — the "Mary hidden" corruption).
//   I2  Repoints are bijections: reservations never lost, never sharing a
//       primary table, occupied-table claims disjoint.
//   I3  reconcileTables is idempotent (second pass returns the SAME array).
//   I4  Live tables are sacrosanct: reconcile never touches a table holding
//       service content.
//   I5  No single-booking guest on two tables after reconcile — even when the
//       board moved and the reservation is STALE (lagging device / watch),
//       which is the exact shape of the 04.07 Ilya/Helena duplication.
//
// Deterministic: fixed seeds, so a failure is reproducible. On failure the
// message carries the seed and op log — re-run with that seed to debug.

import { describe, it, expect } from "vitest";
import {
  blankTable, tableHasServiceContent, reservationTableIds,
  repointReservation, moveTableRows, swapTableRows,
} from "../utils/tableHelpers.js";
import { reconcileTables } from "../utils/reconcile.js";

// mulberry32 — tiny deterministic PRNG, good enough for op shuffling.
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

const TABLE_COUNT = 10;
const resvKey = (t) =>
  `${String(t?.resName || "").trim().toLowerCase()}|${String(t?.resTime || "")}`;

// Random day sheet: 3–6 reservations on distinct tables, ~1 in 3 a two-table
// group (the multi-table shape the reconcile must honour).
const makeFixture = (rnd) => {
  const tables = Array.from({ length: TABLE_COUNT }, (_, i) => blankTable(i + 1));
  const free = tables.map((t) => t.id);
  const reservations = [];
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n && free.length; i++) {
    const grouped = rnd() < 0.34 && free.length >= 2;
    const a = free.splice(Math.floor(rnd() * free.length), 1)[0];
    const group = [a];
    if (grouped) group.push(free.splice(Math.floor(rnd() * free.length), 1)[0]);
    group.sort((x, y) => x - y);
    reservations.push({
      id: `r${i}`,
      date: "2026-07-04",
      table_id: group[0],
      data: {
        resName: `Guest ${i}`,
        resTime: pick(rnd, ["18:00", "19:30", "20:15"]),
        guests: 2 + Math.floor(rnd() * 3),
        tableGroup: group.length > 1 ? group : [],
      },
    });
  }
  return { tables, reservations };
};

const ownerOf = (reservations, tid) =>
  reservations.find((r) => reservationTableIds(r.data, r.table_id).includes(Number(tid)));

// Mirrors App's onMoveTable persistence step: board rows move via the real
// transform, then the owning reservation(s) repoint through repointReservation.
const applyMove = (state, from, to, useSwap) => {
  const tables = useSwap
    ? swapTableRows(state.tables, from, to)
    : moveTableRows(state.tables, from, to);
  const src = ownerOf(state.reservations, from);
  const dst = useSwap ? ownerOf(state.reservations, to) : null;
  const reservations = state.reservations.map((r) => {
    if (src && r.id === src.id) return { ...r, ...repointReservation(r, from, to) };
    if (dst && dst.id !== src?.id && r.id === dst.id) return { ...r, ...repointReservation(r, from, to) };
    return r;
  });
  return { tables, reservations };
};

const invariantHolds = (state, seed, opLog) => {
  const label = `seed ${seed} after [${opLog.join(" → ")}]`;

  // I1 — every reservation's primary id is inside its own occupancy set.
  for (const r of state.reservations) {
    expect(
      reservationTableIds(r.data, r.table_id).includes(Number(r.table_id)),
      `${label}: I1 violated — ${r.id} table_id=${r.table_id} outside its tableGroup [${r.data.tableGroup}]`,
    ).toBe(true);
  }

  // I2 — bijection: none lost, primaries distinct, occupancy sets disjoint.
  const primaries = state.reservations.map((r) => Number(r.table_id));
  expect(new Set(primaries).size, `${label}: I2 violated — two reservations share a primary table`).toBe(primaries.length);
  const claimed = new Set();
  for (const r of state.reservations) {
    for (const tid of reservationTableIds(r.data, r.table_id)) {
      expect(claimed.has(tid), `${label}: I2 violated — table ${tid} claimed by two reservations`).toBe(false);
      claimed.add(tid);
    }
  }
};

const reconcileInvariantsHold = (state, seed, opLog) => {
  const label = `seed ${seed} after [${opLog.join(" → ")}]`;
  const before = state.tables;
  const rows = state.reservations.filter((r) => !r.data?.clearedFromBoard);
  const after = reconcileTables(before, rows, []);

  // I4 — live tables sacrosanct: same object, byte for byte.
  for (const t of before) {
    if (!tableHasServiceContent(t)) continue;
    const nt = after.find((x) => x.id === t.id);
    expect(nt, `${label}: I4 violated — live table ${t.id} rebuilt/blanked by reconcile`).toEqual(t);
  }

  // I3 — idempotent: a second pass changes nothing and returns the SAME array
  // (reconcileTables returns prevTables untouched when no table moved).
  expect(reconcileTables(after, rows, []), `${label}: I3 violated — reconcile not idempotent`).toBe(after);

  // I5 — no single-booking guest on two tables. Count board tables carrying
  // each single-table reservation's name/time; grouped bookings may legally
  // appear on every member table.
  for (const r of rows) {
    const group = reservationTableIds(r.data, r.table_id);
    if (group.length > 1) continue;
    const key = resvKey({ resName: r.data.resName, resTime: r.data.resTime });
    const carriers = after.filter((t) => resvKey(t) === key).map((t) => t.id);
    expect(
      carriers.length <= 1,
      `${label}: I5 violated — single booking "${r.data.resName}" on tables [${carriers}]`,
    ).toBe(true);
  }

  return after;
};

describe("board invariants under random move/swap/reconcile sequences", () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  const OPS_PER_RUN = 25;

  it.each(SEEDS.map((s) => [s]))("holds for seed %i", (seed) => {
    const rnd = mulberry32(seed);
    let state = makeFixture(rnd);
    const opLog = [];

    // Template the board from the reservations first, like entering service.
    state = { ...state, tables: reconcileInvariantsHold(state, seed, ["initial reconcile"]) };

    for (let step = 0; step < OPS_PER_RUN; step++) {
      const op = pick(rnd, ["seat", "move", "swap", "staleMove", "reconcile", "reconcile"]);

      if (op === "seat") {
        // Staff seats a templated table: the whole group goes live.
        const candidates = state.tables.filter((t) => t.resName && !t.active);
        if (!candidates.length) continue;
        const t0 = pick(rnd, candidates);
        const group = t0.tableGroup?.length > 1 ? t0.tableGroup : [t0.id];
        opLog.push(`seat T${t0.id}`);
        state = {
          ...state,
          tables: state.tables.map((t) =>
            group.includes(t.id) ? { ...t, active: true, arrivedAt: "19:00" } : t),
        };
      } else if (op === "move" || op === "swap") {
        // Detail → CHANGE TABLE. Move targets a free table; swap exchanges two
        // occupied ones (single-table bookings only — matching the UI, which
        // moves a group by its member tables one at a time is not offered).
        const owned = state.tables.filter((t) => ownerOf(state.reservations, t.id));
        if (!owned.length) continue;
        const from = pick(rnd, owned).id;
        if (op === "move") {
          const freeTables = state.tables.filter(
            (t) => !tableHasServiceContent(t) && !t.resName && !ownerOf(state.reservations, t.id));
          if (!freeTables.length) continue;
          const to = pick(rnd, freeTables).id;
          opLog.push(`move T${from}→T${to}`);
          state = applyMove(state, from, to, false);
        } else {
          const others = owned.filter((t) => t.id !== from);
          if (!others.length) continue;
          const to = pick(rnd, others).id;
          opLog.push(`swap T${from}↔T${to}`);
          state = applyMove(state, from, to, true);
        }
      } else if (op === "staleMove") {
        // The 04.07 incident shape: the BOARD moves but the reservation does
        // NOT follow (lagging watch / another device's half-landed switch).
        // Later reconciles must still refuse to duplicate the seated guest
        // back onto the vacated table. Single-table seated bookings only.
        const seated = state.tables.filter((t) => {
          const owner = ownerOf(state.reservations, t.id);
          return tableHasServiceContent(t) && t.resName && owner
            && reservationTableIds(owner.data, owner.table_id).length === 1;
        });
        const freeTables = state.tables.filter(
          (t) => !tableHasServiceContent(t) && !t.resName && !ownerOf(state.reservations, t.id));
        if (!seated.length || !freeTables.length) continue;
        const from = pick(rnd, seated).id;
        const to = pick(rnd, freeTables).id;
        opLog.push(`staleMove T${from}→T${to}`);
        state = { ...state, tables: moveTableRows(state.tables, from, to) };
        // Heal the model AFTER checking reconcile behaves (the app heals the
        // same way: the switch's reservation write eventually lands).
        state = { ...state, tables: reconcileInvariantsHold(state, seed, opLog) };
        const owner = ownerOf(state.reservations, from);
        if (owner) {
          state = {
            ...state,
            reservations: state.reservations.map((r) =>
              r.id === owner.id ? { ...r, ...repointReservation(r, from, to) } : r),
          };
        }
      } else {
        opLog.push("reconcile");
        state = { ...state, tables: reconcileInvariantsHold(state, seed, opLog) };
      }

      invariantHolds(state, seed, opLog);
    }
  });

  it("reconcile after a stale switch leaves the vacated table blank (04.07 shape)", () => {
    // Directed replay of the incident: Ilya seated on T2, board state moved to
    // T4, reservation still pointing at T2. The reconcile must NOT rebuild T2
    // from the stale reservation — the guest would be on both tables.
    const tables = Array.from({ length: 4 }, (_, i) => blankTable(i + 1));
    const reservations = [{
      id: "ilya", date: "2026-07-04", table_id: 2,
      data: { resName: "Ilya Ulyanov", resTime: "19:30", guests: 2, tableGroup: [] },
    }];
    let board = reconcileTables(tables, reservations, []);
    board = board.map((t) => (t.id === 2 ? { ...t, active: true, arrivedAt: "19:43" } : t));
    board = moveTableRows(board, 2, 4); // board moved, reservation stale
    const after = reconcileTables(board, reservations, []);
    const carriers = after.filter((t) => t.resName === "Ilya Ulyanov").map((t) => t.id);
    expect(carriers).toEqual([4]);
    expect(tableHasServiceContent(after.find((t) => t.id === 2))).toBe(false);
  });
});
