import { describe, it, expect } from "vitest";
import {
  firstFilled,
  truthyCell,
  splitMainSubCell,
  parseBilingual,
} from "../utils/menuUtils.js";

describe("firstFilled", () => {
  it("returns the first non-empty value", () => {
    expect(firstFilled("", null, "hello")).toBe("hello");
    expect(firstFilled("first", "second")).toBe("first");
  });

  it("returns empty string when all values are empty", () => {
    expect(firstFilled("", null, undefined, "  ")).toBe("");
  });

  it("treats whitespace-only strings as empty", () => {
    expect(firstFilled("   ", "value")).toBe("value");
  });

  it("works with no arguments", () => {
    expect(firstFilled()).toBe("");
  });
});

describe("truthyCell", () => {
  it.each([
    ["TRUE", true],
    ["true", true],
    ["True", true],
    ["yes", true],
    ["YES", true],
    ["y", true],
    ["Y", true],
    ["1", true],
    ["wahr", true],
  ])("treats %s as truthy", (input, expected) => {
    expect(truthyCell(input)).toBe(expected);
  });

  it.each([
    ["FALSE", false],
    ["false", false],
    ["no", false],
    ["0", false],
    ["", false],
    [null, false],
    [undefined, false],
    ["  ", false],
    ["nope", false],
  ])("treats %s as falsy", (input, expected) => {
    expect(truthyCell(input)).toBe(expected);
  });
});

describe("splitMainSubCell", () => {
  it("splits on pipe into name and sub", () => {
    expect(splitMainSubCell("Lamb|Rosemary jus")).toEqual({
      name: "Lamb",
      sub: "Rosemary jus",
    });
  });

  it("trims whitespace around pipe", () => {
    expect(splitMainSubCell(" Lamb | Rosemary jus ")).toEqual({
      name: "Lamb",
      sub: "Rosemary jus",
    });
  });

  it("uses separate sub argument when no pipe", () => {
    expect(splitMainSubCell("Lamb", "Rosemary jus")).toEqual({
      name: "Lamb",
      sub: "Rosemary jus",
    });
  });

  it("multiple pipes: first segment is name, rest joined as sub", () => {
    expect(splitMainSubCell("A|B|C")).toEqual({ name: "A", sub: "B|C" });
  });

  it("pipe with empty sub falls back to sub argument", () => {
    expect(splitMainSubCell("Lamb|", "fallback")).toEqual({
      name: "Lamb",
      sub: "fallback",
    });
  });

  it("returns null for empty title and empty sub", () => {
    expect(splitMainSubCell("", "")).toBeNull();
    expect(splitMainSubCell(null, null)).toBeNull();
  });

  it("handles title-only (no sub, no pipe)", () => {
    expect(splitMainSubCell("Lamb")).toEqual({ name: "Lamb", sub: "" });
  });
});

describe("parseBilingual", () => {
  it("parses 3-line cell into EN, SI, and note", () => {
    const result = parseBilingual("Lamb\nJagnje\nKitchen note");
    expect(result.en).toEqual({ name: "Lamb", sub: "" });
    expect(result.si).toEqual({ name: "Jagnje", sub: "" });
    expect(result.note).toBe("Kitchen note");
  });

  it("parses 2-line cell — EN and SI only, no note", () => {
    const result = parseBilingual("Lamb\nJagnje");
    expect(result.en).toEqual({ name: "Lamb", sub: "" });
    expect(result.si).toEqual({ name: "Jagnje", sub: "" });
    expect(result.note).toBe("");
  });

  it("parses 1-line cell — EN only, no SI, no note", () => {
    const result = parseBilingual("Lamb");
    expect(result.en).toEqual({ name: "Lamb", sub: "" });
    expect(result.si).toBeNull();
    expect(result.note).toBe("");
  });

  it("blank line 2 means no SI — does NOT shift line 3 into SI slot", () => {
    const result = parseBilingual("Lamb\n\nKitchen note");
    expect(result.en).toEqual({ name: "Lamb", sub: "" });
    expect(result.si).toBeNull();
    expect(result.note).toBe("Kitchen note");
  });

  it("parses pipe-separated name|sub in EN line", () => {
    const result = parseBilingual("Lamb|Rosemary jus\nJagnje|Rožmarin");
    expect(result.en).toEqual({ name: "Lamb", sub: "Rosemary jus" });
    expect(result.si).toEqual({ name: "Jagnje", sub: "Rožmarin" });
  });

  it("merges sub column into EN and SI name+sub", () => {
    const result = parseBilingual("Lamb\nJagnje", "Rosemary jus\nRožmarin");
    expect(result.en).toEqual({ name: "Lamb", sub: "Rosemary jus" });
    expect(result.si).toEqual({ name: "Jagnje", sub: "Rožmarin" });
  });

  it("returns null EN for empty cell", () => {
    const result = parseBilingual("");
    expect(result.en).toBeNull();
    expect(result.si).toBeNull();
    expect(result.note).toBe("");
  });

  it("handles null inputs gracefully", () => {
    const result = parseBilingual(null, null);
    expect(result.en).toBeNull();
    expect(result.si).toBeNull();
  });
});
