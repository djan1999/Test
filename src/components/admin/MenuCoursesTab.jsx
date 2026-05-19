import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import CourseEditor from "./CourseEditor.jsx";

const FONT = tokens.font;

const isTruthyShort = v => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr";
};

function ShortMenuOverview({ menuCourses, onUpdateCourses }) {
  const active = menuCourses.filter(c => c.is_active !== false && !c.is_snack);
  const flagged = active.filter(c => isTruthyShort(c.show_on_short));
  const unflagged = active.filter(c => !isTruthyShort(c.show_on_short));

  const toggle = (course) => {
    const next = !isTruthyShort(course.show_on_short);
    onUpdateCourses(menuCourses.map(c =>
      c.position === course.position ? { ...c, show_on_short: next } : c
    ));
  };

  const Row = ({ course, included }) => (
    <div style={{
      display: "grid",
      gridTemplateColumns: "24px 1fr auto 60px",
      alignItems: "center",
      gap: 8,
      padding: "5px 8px",
      borderBottom: `1px solid ${tokens.ink[5]}`,
      background: included ? tokens.tint.parchment : tokens.neutral[0],
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[4] }}>{course.position}</span>
      <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[0], fontWeight: included ? 600 : 400 }}>
        {course.menu?.name || course.course_key || "(unnamed)"}
        {course.course_category !== "main" && (
          <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], marginLeft: 6, textTransform: "uppercase", letterSpacing: "0.10em" }}>
            {course.course_category}
          </span>
        )}
      </span>
      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: FONT, fontSize: 9, color: tokens.ink[2] }}>
        <input
          type="checkbox"
          checked={included}
          onChange={() => toggle(course)}
        />
        Short Menu
      </label>
      <input
        type="number"
        value={course.short_order ?? ""}
        onChange={e => onUpdateCourses(menuCourses.map(c =>
          c.position === course.position ? { ...c, short_order: e.target.value ? Number(e.target.value) : null } : c
        ))}
        disabled={!included}
        placeholder="order"
        style={{
          fontFamily: FONT, fontSize: 10, padding: "3px 6px",
          border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, outline: "none",
          background: included ? tokens.neutral[0] : tokens.ink[5],
          color: tokens.ink[0], width: "100%", boxSizing: "border-box",
        }}
      />
    </div>
  );

  return (
    <div style={{
      marginBottom: 20,
      border: `1px solid ${tokens.ink[4]}`,
      borderRadius: 0,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 10px",
        background: tokens.ink.bg,
        borderBottom: `1px solid ${tokens.ink[4]}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <div>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[2], fontWeight: 700 }}>
            Short Menu Courses
          </span>
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginLeft: 10 }}>
            {flagged.length} of {active.length} courses · use Sync in Menu Layout to apply to profiles
          </span>
        </div>
      </div>
      {/* Header row */}
      <div style={{
        display: "grid", gridTemplateColumns: "24px 1fr auto 60px",
        gap: 8, padding: "4px 8px",
        background: tokens.ink.bg, borderBottom: `1px solid ${tokens.ink[4]}`,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3] }}>#</span>
        <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase" }}>Course</span>
        <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase" }}>Inclusion</span>
        <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase" }}>Order</span>
      </div>
      {active.length === 0 && (
        <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[4], padding: "16px 10px" }}>No active courses.</div>
      )}
      {/* Short menu courses first */}
      {flagged.map(c => <Row key={c.position} course={c} included={true} />)}
      {/* Separator if both groups have entries */}
      {flagged.length > 0 && unflagged.length > 0 && (
        <div style={{ padding: "4px 8px", background: tokens.ink[5], fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase" }}>
          Not on Short Menu
        </div>
      )}
      {unflagged.map(c => <Row key={c.position} course={c} included={false} />)}
    </div>
  );
}

export default function MenuCoursesTab({ menuCourses = [], onUpdateCourses, onSaveCourses }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showShortOverview, setShowShortOverview] = useState(true);

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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], letterSpacing: 1 }}>
            {menuCourses.length} COURSES
          </div>
          <button
            onClick={() => setShowShortOverview(x => !x)}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
              border: `1px solid ${showShortOverview ? tokens.charcoal.default : tokens.ink[4]}`,
              borderRadius: 0, cursor: "pointer",
              background: showShortOverview ? tokens.tint.parchment : tokens.neutral[0],
              color: showShortOverview ? tokens.ink[0] : tokens.ink[3],
            }}
          >
            {showShortOverview ? "▴ Short Menu" : "▾ Short Menu"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={addCourse} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
            background: tokens.neutral[0], color: tokens.ink[0],
          }}>+ ADD COURSE</button>
          <button onClick={handleSave} disabled={saving} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${saved ? tokens.green.border : tokens.charcoal.default}`, borderRadius: 0,
            cursor: saving ? "default" : "pointer",
            background: tokens.neutral[0], color: saved ? tokens.green.text : tokens.ink[0],
          }}>{saving ? "SAVING…" : saved ? "SAVED ✓" : "SAVE ALL COURSES"}</button>
        </div>
      </div>

      {showShortOverview && menuCourses.length > 0 && (
        <ShortMenuOverview menuCourses={menuCourses} onUpdateCourses={onUpdateCourses} />
      )}

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
        <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[4], textAlign: "center", padding: "40px 0" }}>
          No courses yet — add your first course above
        </div>
      )}
    </div>
  );
}
