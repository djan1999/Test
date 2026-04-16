import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import CourseEditor from "./CourseEditor.jsx";

const FONT = tokens.font;

export default function MenuCoursesTab({ menuCourses = [], onUpdateCourses, onSaveCourses }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    await onSaveCourses(menuCourses);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const updateCourse = (position, updated) => {
    onUpdateCourses(menuCourses.map(c => c.position === position ? updated : c));
  };

  const deleteCourse = (position) => {
    if (!window.confirm("Delete this course?")) return;
    onUpdateCourses(menuCourses.filter(c => c.position !== position));
  };

  const moveCourse = (position, dir) => {
    const idx = menuCourses.findIndex(c => c.position === position);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= menuCourses.length) return;
    const reordered = [...menuCourses];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    // Re-assign positions sequentially
    onUpdateCourses(reordered.map((c, i) => ({ ...c, position: i + 1 })));
  };

  const addCourse = () => {
    const maxPos = menuCourses.reduce((m, c) => Math.max(m, c.position || 0), 0);
    const newCourse = {
      position: maxPos + 1,
      menu: { name: "", sub: "" },
      menu_si: null,
      wp: null, wp_si: null, na: null, na_si: null, os: null, os_si: null, premium: null, premium_si: null,
      hazards: null, is_snack: false,
      course_key: "", course_category: "main", optional_flag: "", optional_pairing_flag: "", optional_pairing_label: "", section_gap_before: false,
      optional_pairing_enabled: false,
      optional_pairing_default_on: true,
      optional_pairing_alco: null,
      optional_pairing_alco_si: null,
      optional_pairing_na: null,
      optional_pairing_na_si: null,
      show_on_short: false, short_order: null,
      force_pairing_title: "", force_pairing_sub: "",
      force_pairing_title_si: "", force_pairing_sub_si: "",
      kitchen_note: "", aperitif_btn: null,
      restrictions: {},
    };
    onUpdateCourses([...menuCourses, newCourse]);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>
          {menuCourses.length} COURSES
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={addCourse} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: "1px solid #b8975e", borderRadius: 0, cursor: "pointer",
            background: "#c8a96e", color: "#fff",
          }}>+ ADD COURSE</button>
          <button onClick={handleSave} disabled={saving} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${saved ? "#4a9a6a" : "#c8a06e"}`, borderRadius: 0,
            cursor: saving ? "default" : "pointer",
            background: saved ? "#4a9a6a" : "#c8a06e", color: "#fff",
          }}>{saving ? "SAVING…" : saved ? "SAVED ✓" : "SAVE ALL COURSES"}</button>
        </div>
      </div>

      {menuCourses.map((course, idx) => (
        <CourseEditor
          key={course.position}
          course={course}
          onUpdate={updated => updateCourse(course.position, updated)}
          onDelete={() => deleteCourse(course.position)}
          onMoveUp={() => moveCourse(course.position, -1)}
          onMoveDown={() => moveCourse(course.position, +1)}
          isFirst={idx === 0}
          isLast={idx === menuCourses.length - 1}
        />
      ))}

      {menuCourses.length === 0 && (
        <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "40px 0" }}>
          No courses yet — add your first course above
        </div>
      )}
    </div>
  );
}
