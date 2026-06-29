import { describe, it, expect } from "vitest";
import {
  buildDefaultLongMenuTemplate,
  buildDefaultShortMenuTemplate,
} from "../utils/menuTemplateSchema.js";
import { deriveCourseKeysFromTemplate } from "../utils/menuLayoutProfiles.js";

const courseRows = (tpl) =>
  tpl.rows.filter(r => r.left?.type === "course" || r.right?.type === "course");
const gapRows = (tpl) => tpl.rows.filter(r => (r.gap || 0) > 0);

describe("buildDefaultLongMenuTemplate", () => {
  it("is a v2 template with the house long-menu row count", () => {
    const t = buildDefaultLongMenuTemplate();
    expect(t.version).toBe(2);
    expect(t.rows).toHaveLength(23);
  });

  it("leaves every course slot empty so dishes must be entered", () => {
    const t = buildDefaultLongMenuTemplate();
    const slots = courseRows(t);
    expect(slots).toHaveLength(18);
    slots.forEach(r => expect(r.left.courseKey).toBe(""));
    // No course is preset — nothing resolves until the user fills slots in.
    expect(deriveCourseKeysFromTemplate(t)).toEqual([]);
  });

  it("keeps the section gap from the house layout", () => {
    const gaps = gapRows(buildDefaultLongMenuTemplate());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap).toBe(15.5);
  });

  it("preserves the aperitif / optional-pairing drink scaffolding", () => {
    const t = buildDefaultLongMenuTemplate();
    const sources = t.rows.filter(r => r.right?.type === "drinks").map(r => r.right.drinkSource);
    expect(sources.filter(s => s === "aperitif")).toHaveLength(3);
    expect(sources.filter(s => s === "optional_pairing")).toHaveLength(3);
  });

  it("mints fresh row ids on each call (repeated rebuilds never collide)", () => {
    const a = buildDefaultLongMenuTemplate();
    const b = buildDefaultLongMenuTemplate();
    const ids = new Set([...a.rows, ...b.rows].map(r => r.id));
    expect(ids.size).toBe(a.rows.length + b.rows.length);
  });
});

describe("buildDefaultShortMenuTemplate", () => {
  it("is a v2 template with the house short-menu row count", () => {
    const t = buildDefaultShortMenuTemplate();
    expect(t.version).toBe(2);
    expect(t.rows).toHaveLength(18);
  });

  it("leaves every course slot empty", () => {
    const t = buildDefaultShortMenuTemplate();
    const slots = courseRows(t);
    expect(slots).toHaveLength(13);
    slots.forEach(r => expect(r.left.courseKey).toBe(""));
    expect(deriveCourseKeysFromTemplate(t)).toEqual([]);
  });

  it("keeps the short-menu section gap", () => {
    const gaps = gapRows(buildDefaultShortMenuTemplate());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap).toBe(14.5);
  });
});
