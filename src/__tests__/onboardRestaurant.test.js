import { describe, expect, it } from "vitest";
import {
  makeRestaurantConfig,
  makeStarterCourses,
  normalizeSlug,
  parseArgs,
} from "../../scripts/onboard-restaurant.mjs";

describe("controlled restaurant onboarding", () => {
  it("derives a stable tenant slug without retaining punctuation", () => {
    expect(normalizeSlug(" Gostilna Špička! ")).toBe("gostilna-spicka");
  });

  it("is dry-run by default and validates the bounded table count", () => {
    expect(parseArgs(["--name", "Bistro", "--admin-email", "owner@example.com"]))
      .toMatchObject({ apply: false, slug: "bistro", tableCount: 10, courseCount: 8, kind: "restaurant" });
    expect(() => parseArgs([
      "--name", "Bistro", "--admin-email", "owner@example.com", "--tables", "61",
    ])).toThrow(/between 1 and 60/i);
  });

  it("creates a neutral editable course scaffold without restaurant-specific flags", () => {
    const courses = makeStarterCourses(3);
    expect(courses.map((course) => course.course_key)).toEqual(["course_01", "course_02", "course_03"]);
    expect(courses.map((course) => course.menu.name)).toEqual(["Course 1", "Course 2", "Course 3"]);
    expect(JSON.stringify(courses)).not.toMatch(/milka|crayfish|n_a_champagne/i);
  });

  it("seeds neutral tenant-owned settings with catalogue automation off", () => {
    const config = makeRestaurantConfig({ name: "Bistro", tableCount: 3, roomOptions: [] });
    expect(config).toMatchObject({
      name: "Bistro",
      subtitle: "SERVICE BOARD",
      features: { hotelGuests: false, roomOptions: [] },
    });
    expect(config.tables.map((table) => table.label)).toEqual(["T01", "T02", "T03"]);
  });

  it("enables hotel fields only when the operator supplies room choices", () => {
    const config = makeRestaurantConfig({
      name: "Hotel Restaurant",
      tableCount: 2,
      roomOptions: ["101", "101", "202"],
    });
    expect(config.features).toEqual({ hotelGuests: true, roomOptions: ["101", "202"] });
  });
});
