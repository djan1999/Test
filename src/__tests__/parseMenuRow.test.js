import { describe, it, expect } from "vitest";
import { parseMenuRow } from "../utils/menuUtils.js";

function row(overrides = {}) {
  return {
    "#": "1",
    dish: "Lamb|Rosemary jus",
    description: "",
    dish_si: "",
    dish_si_sub: "",
    course_key: "",
    "snack?": "",
    wp_drink: "", wp_sub: "",
    na_drink: "", na_sub: "",
    os_drink: "", os_sub: "",
    premium: "", premium_sub: "",
    optional_flag: "",
    section_gap_before: "",
    show_on_short: "",
    short_order: "",
    force_pairing_title: "",
    force_pairing_sub: "",
    kitchen_note: "",
    aperitif_btn: "",
    ...overrides,
  };
}

describe("parseMenuRow", () => {
  it("returns null when dish has no name", () => {
    expect(parseMenuRow(row({ dish: "" }))).toBeNull();
  });

  it("parses basic dish name and sub from pipe", () => {
    const r = parseMenuRow(row());
    expect(r.menu).toEqual({ name: "Lamb", sub: "Rosemary jus" });
  });

  it("derives course_key from dish name when not provided", () => {
    const r = parseMenuRow(row({ dish: "Danube Salmon" }));
    expect(r.course_key).toBe("danube_salmon");
  });

  it("uses explicit course_key column when provided", () => {
    const r = parseMenuRow(row({ course_key: "MY_KEY" }));
    expect(r.course_key).toBe("my_key");
  });

  it("normalises course_key: lowercase, replace spaces/& with underscores", () => {
    const r = parseMenuRow(row({ course_key: "Fish & Chips" }));
    expect(r.course_key).toBe("fish_and_chips");
  });

  it("parses position from # column", () => {
    const r = parseMenuRow(row({ "#": "3" }));
    expect(r.position).toBe(3);
  });

  it("defaults position to 0 when missing", () => {
    const r = parseMenuRow(row({ "#": "" }));
    expect(r.position).toBe(0);
  });

  it("parses SI dish from dish_si column", () => {
    const r = parseMenuRow(row({ dish: "Lamb", dish_si: "Jagnje" }));
    expect(r.menu_si).toEqual({ name: "Jagnje", sub: "" });
  });

  it("falls back to line 2 of dish column for SI when dish_si missing", () => {
    const r = parseMenuRow(row({ dish: "Lamb\nJagnje" }));
    expect(r.menu_si).toEqual({ name: "Jagnje", sub: "" });
  });

  it("sets menu_si to null when no SI dish", () => {
    const r = parseMenuRow(row({ dish: "Lamb" }));
    expect(r.menu_si).toBeNull();
  });

  it("parses wine pairing from wp_drink", () => {
    const r = parseMenuRow(row({ wp_drink: "Mosel Riesling|dry" }));
    expect(r.wp).toEqual({ name: "Mosel Riesling", sub: "dry" });
  });

  it("parses non-alcoholic pairing from na_drink", () => {
    const r = parseMenuRow(row({ na_drink: "Elderflower" }));
    expect(r.na).toEqual({ name: "Elderflower", sub: "" });
  });

  it("parses is_snack from snack? column", () => {
    expect(parseMenuRow(row({ "snack?": "yes" })).is_snack).toBe(true);
    expect(parseMenuRow(row({ "snack?": "" })).is_snack).toBe(false);
  });

  it("parses section_gap_before", () => {
    expect(parseMenuRow(row({ section_gap_before: "true" })).section_gap_before).toBe(true);
  });

  it("parses kitchen_note", () => {
    const r = parseMenuRow(row({ kitchen_note: "serve hot" }));
    expect(r.kitchen_note).toBe("serve hot");
  });

  it("falls back to line 3 of dish for kitchen_note", () => {
    const r = parseMenuRow(row({ dish: "Lamb\nJagnje\nserve hot" }));
    expect(r.kitchen_note).toBe("serve hot");
  });

  it("parses aperitif_btn", () => {
    const r = parseMenuRow(row({ aperitif_btn: "Krug" }));
    expect(r.aperitif_btn).toBe("Krug");
  });

  it("sets aperitif_btn to null when empty", () => {
    const r = parseMenuRow(row({ aperitif_btn: "" }));
    expect(r.aperitif_btn).toBeNull();
  });

  it("stores restriction values inside restrictions object", () => {
    const r = parseMenuRow(row({ vegan: "Vegan option|plant-based" }));
    expect(r.restrictions.vegan).toEqual({ name: "Vegan option", sub: "plant-based" });
  });

  it("stores SI restriction under key_si", () => {
    const r = parseMenuRow(row({ vegan: "Vegan option\nVeganska možnost" }));
    expect(r.restrictions.vegan_si).toEqual({ name: "Veganska možnost", sub: "" });
  });

  it("stores restriction note under key_note", () => {
    const r = parseMenuRow(row({ no_pork: "Pork-free\n\nno guanciale" }));
    expect(r.restrictions.no_pork_note).toBe("no guanciale");
  });

  it("parses bilingual force_pairing_title from newline", () => {
    const r = parseMenuRow(row({ force_pairing_title: "Krug\nKrug SI" }));
    expect(r.force_pairing_title).toBe("Krug");
    expect(r.force_pairing_title_si).toBe("Krug SI");
  });
});
