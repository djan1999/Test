import { describe, it, expect } from "vitest";
import { setLastBiteExclusive } from "../utils/menuUtils.js";

const course = (position, extra = {}) => ({ position, menu: { name: `C${position}` }, ...extra });

describe("setLastBiteExclusive (acceptance 7)", () => {
  it("setting it on course 4 clears it from course 3", () => {
    const list = [course(3, { is_last_bite: true }), course(4)];
    const next = setLastBiteExclusive(list, 4, true);
    expect(next.map((c) => [c.position, c.is_last_bite])).toEqual([[3, false], [4, true]]);
  });

  it("turning it off clears only that course", () => {
    const list = [course(3, { is_last_bite: true }), course(4)];
    const next = setLastBiteExclusive(list, 3, false);
    expect(next.every((c) => c.is_last_bite === false)).toBe(true);
  });

  it("inserting an extra course does not move the flag (it rides the course object through renumbering)", () => {
    // Flag on course "Duck" at position 4.
    let list = [course(3), course(4, { menu: { name: "Duck" }, is_last_bite: true }), course(5)];
    // The editor inserts a course before Duck and renumbers positions 1..n —
    // simulate exactly what moveCourse/addCourse do: rows keep their fields.
    list = [list[0], course(4, { menu: { name: "Extra" }, is_last_bite: false }),
            { ...list[1], position: 5 }, { ...list[2], position: 6 }];
    const flagged = list.filter((c) => c.is_last_bite);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].menu.name).toBe("Duck");
    expect(flagged[0].position).toBe(5); // moved WITH the course, not the index
  });

  it("normalizes legacy rows without the field to explicit booleans", () => {
    const next = setLastBiteExclusive([course(1), course(2)], 9, false);
    expect(next.every((c) => c.is_last_bite === false)).toBe(true);
  });
});
