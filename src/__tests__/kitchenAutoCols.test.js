import { describe, it, expect } from "vitest";
import { estimateAutoCols } from "../components/kitchen/KitchenBoard.jsx";
import { COLS_MIN, COLS_MAX } from "../hooks/useKitchenColumns.js";

describe("estimateAutoCols — responsive kitchen column count", () => {
  it("fits a single column on a phone", () => {
    expect(estimateAutoCols(390)).toBe(1);
  });

  it("fits a few columns on a tablet/laptop", () => {
    expect(estimateAutoCols(1280)).toBe(5);
  });

  it("fits ~10 tickets on a 32\" QHD (2560px) display", () => {
    expect(estimateAutoCols(2560)).toBe(10);
  });

  it("packs more on a 4K (3840px) display", () => {
    expect(estimateAutoCols(3840)).toBeGreaterThanOrEqual(14);
  });

  it("never returns fewer than the minimum", () => {
    expect(estimateAutoCols(120)).toBe(COLS_MIN);
  });

  it("never exceeds the maximum", () => {
    expect(estimateAutoCols(99999)).toBe(COLS_MAX);
  });
});
