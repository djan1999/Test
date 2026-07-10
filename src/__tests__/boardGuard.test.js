// ── Mass-blank guard predicate ────────────────────────────────────────────────
// The autosave's defense-in-depth guard refuses to persist a blank of 2+
// tables that previously HELD service content unless a legitimate whole-board
// clear flagged it (intentionalBoardClearRef). The refusal branch is
// UNREACHABLE through honest UI vectors — the reconcile shields contentful
// tables, store adoption advances the diff baseline before the autosave
// diffs, and every legit mass-clear sets the flag — which is exactly why the
// predicate needs unit coverage: it exists for the bug we haven't met yet.
// (The flagged pass-through is pinned end-to-end in appHarness: the overnight
// auto-end blanks the whole board WITHOUT tripping the guard.)

import { describe, it, expect } from "vitest";
import { massBlankedIndices, blankTable, sanitizeTable } from "../utils/tableHelpers.js";

const json = (t) => JSON.stringify(sanitizeTable(t));
const live = (id, extra = {}) => sanitizeTable({ ...blankTable(id), active: true, arrivedAt: "19:30", ...extra });
const blank = (id) => sanitizeTable(blankTable(id));

const run = (prevTables, nextTables) =>
  massBlankedIndices(prevTables.map(json), nextTables, nextTables.map(json));

describe("massBlankedIndices", () => {
  it("flags every table that HELD content and is now blank (the wipe input)", () => {
    const prev = [live(1), live(2), blank(3)];
    const next = [blank(1), blank(2), blank(3)];
    expect(run(prev, next)).toEqual([0, 1]); // ≥2 → App refuses unless flagged
  });

  it("a single-table blank is reported alone — App allows it (normal clear)", () => {
    const prev = [live(1), live(2)];
    const next = [blank(1), live(2)];
    expect(run(prev, next)).toEqual([0]);
  });

  it("content → different content is not a blank; blank → blank is untouched", () => {
    const prev = [live(1), blank(2)];
    const next = [live(1, { guests: 4 }), blank(2)];
    expect(run(prev, next)).toEqual([]);
  });

  it("kitchen activity counts as content (a fired table must not blank silently)", () => {
    const prev = [sanitizeTable({ ...blankTable(1), kitchenLog: { amuse: { firedAt: "19:00" } } }), live(2)];
    const next = [blank(1), blank(2)];
    expect(run(prev, next)).toEqual([0, 1]);
  });

  it("unparseable/missing prev JSON reads as 'held no content' — a blank of it is no loss", () => {
    const next = [blank(1), blank(2)];
    expect(massBlankedIndices(["not-json", undefined], next, next.map(json))).toEqual([]);
  });

  it("reservation labels alone are NOT content — a reserved-but-unstarted table may blank", () => {
    const prev = [sanitizeTable({ ...blankTable(1), resName: "NOVAK", resTime: "19:30" }), live(2)];
    const next = [blank(1), blank(2)];
    expect(run(prev, next)).toEqual([1]); // only the live table counts
  });
});
