import { describe, it, expect } from "vitest";
import { combineMenuPages } from "../utils/printAllPages.js";
import { generateMenuHTML } from "../utils/menuGenerator.js";

const COURSES = [
  { position: 1, course_key: "kefir", menu: { name: "Kefir", sub: "Cucumber, dill" }, restrictions: {} },
  { position: 2, course_key: "trout", menu: { name: "Trout", sub: "Beurre blanc" }, restrictions: {} },
];

const docFor = (seatId) => generateMenuHTML({
  seat: { id: seatId, pairing: "—" },
  table: { menuType: "", restrictions: [], bottleWines: [] },
  menuTitle: `SEAT ${seatId} MENU`,
  menuCourses: COURSES,
  lang: "en",
});

describe("combineMenuPages", () => {
  it("produces one document with one page per seat, in order", () => {
    const combined = combineMenuPages([docFor(1), docFor(2), docFor(3)]);
    expect(combined.match(/class="print-page"/g)).toHaveLength(3);
    // Pages keep their per-seat content and order.
    expect(combined.indexOf("SEAT 1 MENU")).toBeLessThan(combined.indexOf("SEAT 2 MENU"));
    expect(combined.indexOf("SEAT 2 MENU")).toBeLessThan(combined.indexOf("SEAT 3 MENU"));
    // Exactly one document shell.
    expect(combined.match(/<!DOCTYPE html>/g)).toHaveLength(1);
    expect(combined.match(/<body>/g)).toHaveLength(1);
  });

  it("keeps the engine's page markup and styles verbatim", () => {
    const combined = combineMenuPages([docFor(1)]);
    // The engine's sheet structure and CSS survive — this is the same page
    // the single-seat print produces, only wrapped for multi-page printing.
    expect(combined).toContain('id="sheet"');
    expect(combined).toContain('id="scaleTarget"');
    expect(combined).toContain("@page{size:A5 portrait;margin:0;}");
    expect(combined).toContain("Roboto+Mono");
  });

  it("breaks each page onto its own sheet and unlocks the single-page body box", () => {
    const combined = combineMenuPages([docFor(1), docFor(2)]);
    expect(combined).toContain("page-break-after:always");
    // The engine locks html/body to one A5 page; the combined doc must undo
    // that or every page after the first is clipped.
    expect(combined).toContain("html,body{height:auto;overflow:visible;}");
  });

  it("strips the per-page fit scripts and installs one that fits every sheet", () => {
    const combined = combineMenuPages([docFor(1), docFor(2)]);
    // getElementById would only ever fit the first page's duplicate ids.
    expect(combined).not.toContain("getElementById('frame')");
    expect(combined).toContain('querySelectorAll(\'[id="sheet"]\')');
    expect(combined.match(/<script>/g)).toHaveLength(1);
  });

  it("returns null when there is nothing printable", () => {
    expect(combineMenuPages([])).toBe(null);
    expect(combineMenuPages([""])).toBe(null);
  });
});
