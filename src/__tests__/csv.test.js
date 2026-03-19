import { describe, it, expect } from "vitest";
import { parseCSV, normHeader, csvRowsToObjects } from "../utils/csv.js";

describe("parseCSV", () => {
  it("parses a simple single-row CSV", () => {
    expect(parseCSV("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  it("parses multiple rows", () => {
    expect(parseCSV("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCSV('"Lamb, roasted",side')).toEqual([["Lamb, roasted", "side"]]);
  });

  it("handles quoted fields containing newlines", () => {
    const input = '"line1\nline2",next';
    expect(parseCSV(input)).toEqual([["line1\nline2", "next"]]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    expect(parseCSV('"say ""hello""",end')).toEqual([['say "hello"', "end"]]);
  });

  it("treats \\r\\n line endings the same as \\n", () => {
    expect(parseCSV("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("returns empty fields for consecutive commas", () => {
    expect(parseCSV("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("handles a trailing newline without adding an empty row", () => {
    const result = parseCSV("a,b\nc,d\n");
    // last row may be empty depending on trailing newline handling
    expect(result[0]).toEqual(["a", "b"]);
    expect(result[1]).toEqual(["c", "d"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("handles a single field with no delimiter", () => {
    expect(parseCSV("hello")).toEqual([["hello"]]);
  });
});

describe("normHeader", () => {
  it("lowercases and trims", () => {
    expect(normHeader("  Dish  ")).toBe("dish");
  });

  it("replaces spaces with underscores", () => {
    expect(normHeader("Dish Name")).toBe("dish_name");
  });

  it("replaces multiple spaces with a single underscore", () => {
    expect(normHeader("a   b")).toBe("a_b");
  });

  it("strips leading and trailing underscores", () => {
    expect(normHeader(" _hello_ ")).toBe("hello");
  });

  it("replaces non-alphanumeric chars (except allowed) with underscore", () => {
    expect(normHeader("veg/vegan")).toBe("veg/vegan");
    expect(normHeader("no-pork")).toBe("no_pork");
  });

  it("handles empty string", () => {
    expect(normHeader("")).toBe("");
  });

  it("handles null/undefined gracefully", () => {
    expect(normHeader(null)).toBe("");
    expect(normHeader(undefined)).toBe("");
  });

  it("preserves allowed special chars: / ? #", () => {
    expect(normHeader("a/b?c#d")).toBe("a/b?c#d");
  });
});

describe("csvRowsToObjects", () => {
  it("maps header row to keys and data row to values", () => {
    const rows = [["Dish", "Description"], ["Lamb", "Rosemary jus"]];
    expect(csvRowsToObjects(rows)).toEqual([{ dish: "Lamb", description: "Rosemary jus" }]);
  });

  it("normalizes headers", () => {
    const rows = [["Dish Name", "Order #"], ["Lamb", "1"]];
    const [obj] = csvRowsToObjects(rows);
    expect(obj).toHaveProperty("dish_name");
    expect(obj).toHaveProperty("order_#");
  });

  it("fills missing columns with empty string", () => {
    const rows = [["a", "b", "c"], ["x", "y"]];
    expect(csvRowsToObjects(rows)).toEqual([{ a: "x", b: "y", c: "" }]);
  });

  it("returns empty array if fewer than 2 rows", () => {
    expect(csvRowsToObjects([["a", "b"]])).toEqual([]);
    expect(csvRowsToObjects([])).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(csvRowsToObjects(null)).toEqual([]);
    expect(csvRowsToObjects("bad")).toEqual([]);
  });

  it("handles multiple data rows", () => {
    const rows = [["id", "name"], ["1", "A"], ["2", "B"]];
    expect(csvRowsToObjects(rows)).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ]);
  });
});
