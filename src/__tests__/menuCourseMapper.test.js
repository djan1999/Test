import { describe, expect, it } from "vitest";
import { courseToSupabaseRow, supabaseRowToCourse } from "../utils/menuCourseMapper.js";

describe("menu course database mapper", () => {
  it("reads legacy bilingual menu text without losing either language", () => {
    const course = supabaseRowToCourse({
      position: 1,
      menu: { name: "Soup\nJuha", sub: "Herbs\nZelišča" },
      course_category: "main",
      restrictions_si: {},
    });
    expect(course.menu).toEqual({ name: "Soup", sub: "Herbs" });
    expect(course.menu_si).toEqual({ name: "Juha", sub: "Zelišča" });
  });

  it("round-trips restriction translations and notes through restrictions_si", () => {
    const row = courseToSupabaseRow({
      position: 2,
      menu: { name: "Course", sub: "" },
      restrictions: {
        veg: { name: "Alternative", sub: "" },
        veg_si: { name: "Alternativa", sub: "" },
        veg_note: "separate pan",
      },
      course_category: "main",
      optional_flag: "",
    });
    const restored = supabaseRowToCourse({ ...row, restrictions_si: row.restrictions_si });
    expect(restored.restrictions.veg).toEqual({ name: "Alternative", sub: "" });
    expect(restored.restrictions.veg_si).toEqual({ name: "Alternativa", sub: "" });
    expect(restored.restrictions.veg_note).toBe("separate pan");
  });
});
