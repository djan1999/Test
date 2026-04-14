import { useState } from "react";
import { FONT, baseInp } from "./adminStyles.js";

// ── Dietary restriction keys ──────────────────────────────────────────────────
const DIETARY_KEYS = [
  "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap",
];

// ── Pairing types ─────────────────────────────────────────────────────────────
const PAIRING_KEYS = [
  { key: "wp",      label: "Wine"     },
  { key: "na",      label: "Non-Alc"  },
  { key: "os",      label: "Our Story"},
  { key: "premium", label: "Premium"  },
];

// ── CourseCard — inline editor for a single course row ───────────────────────
function CourseCard({ course, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };
  const labelSm = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", textTransform: "uppercase", marginBottom: 2 };

  const upd = (field, value) => onUpdate({ ...course, [field]: value });
  const updMenu = (lang, field, value) => {
    const key = lang === "si" ? "menu_si" : "menu";
    const current = course[key] || { name: "", sub: "" };
    onUpdate({ ...course, [key]: { ...current, [field]: value } });
  };
  const updPairing = (pairingKey, lang, field, value) => {
    const key = lang === "si" ? `${pairingKey}_si` : pairingKey;
    const current = course[key] || { name: "", sub: "" };
    onUpdate({ ...course, [key]: { ...current, [field]: value } });
  };
  const updRestriction = (rKey, field, value) => {
    const restrictions = { ...course.restrictions };
    const current = restrictions[rKey] || { name: "", sub: "", kitchen_note: "" };
    restrictions[rKey] = { ...current, [field]: value };
    onUpdate({ ...course, restrictions });
  };
  const updRestrictionSi = (rKey, field, value) => {
    const restrictions = { ...course.restrictions };
    const siKey = `${rKey}_si`;
    const current = restrictions[siKey] || { name: "", sub: "" };
    restrictions[siKey] = { ...current, [field]: value };
    onUpdate({ ...course, restrictions });
  };

  const removeRestriction = (rKey) => {
    const restrictions = { ...course.restrictions };
    delete restrictions[rKey];
    onUpdate({ ...course, restrictions });
  };

  const removePairing = (pairingKey) => {
    const updated = { ...course };
    delete updated[pairingKey];
    delete updated[`${pairingKey}_si`];
    onUpdate(updated);
  };

  const addRestriction = (rKey) => {
    if (!rKey || course.restrictions?.[rKey] != null) return;
    const restrictions = { ...course.restrictions, [rKey]: { name: "", sub: "", kitchen_note: "" } };
    onUpdate({ ...course, restrictions });
  };

  const addPairing = (pKey) => {
    if (!pKey || course[pKey] != null) return;
    onUpdate({ ...course, [pKey]: { name: "", sub: "" } });
  };

  const activeRestrictions = DIETARY_KEYS.filter(rKey => course.restrictions?.[rKey] != null);
  const activePairings     = PAIRING_KEYS.filter(({ key }) => course[key] != null);
  const availableRestrictions = DIETARY_KEYS.filter(rKey => course.restrictions?.[rKey] == null);
  const availablePairings     = PAIRING_KEYS.filter(({ key }) => course[key] == null);
  const category = String(course.course_category || "main");
  const isOptional = category === "optional" || category === "celebration";
  const optionalPairingEnabled = !!course.optional_pairing_enabled;

  return (
    <div style={{
      border: `1px solid ${isOptional ? "#e0d4b8" : "#e8e8e8"}`, borderRadius: 4,
      background: isOptional ? "#fffdf8" : "#fff",
      marginBottom: 8, overflow: "hidden",
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? "#fafafa" : "transparent",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 10, color: "#bbb", minWidth: 22 }}>{course.position}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{course.menu?.name || "(unnamed)"}</span>
          {course.menu?.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginLeft: 8 }}>{course.menu.sub}</span>}
        </div>
        {isOptional && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#9a6020", background: "#fff3d8", border: "1px solid #e8d090", borderRadius: 2, padding: "2px 6px" }}>OPTIONAL · {course.optional_flag}</span>}
        {activeRestrictions.length > 0 && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#b04040", border: "1px solid #f0cccc", borderRadius: 2, padding: "2px 6px" }}>{activeRestrictions.length}R</span>}
        {activePairings.length > 0 && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#c8a06e", border: "1px solid #e8d8b8", borderRadius: 2, padding: "2px 6px" }}>{activePairings.length}P</span>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", color: isFirst ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▲</button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", color: isLast ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▼</button>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 14, color: "#ccc", transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {expanded && (
        <div style={{ padding: "12px 14px 16px", borderTop: "1px solid #f0f0f0" }}>
          {/* Dish Info */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DISH INFO</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Name (EN)</div><input value={course.menu?.name || ""} onChange={e => updMenu("en", "name", e.target.value)} style={inpSm} placeholder="Dish name" /></div>
            <div><div style={labelSm}>Description (EN)</div><input value={course.menu?.sub || ""} onChange={e => updMenu("en", "sub", e.target.value)} style={inpSm} placeholder="ingredients, description" /></div>
            <div><div style={labelSm}>Name (SI)</div><input value={course.menu_si?.name || ""} onChange={e => updMenu("si", "name", e.target.value)} style={inpSm} placeholder="Slovenian name" /></div>
            <div><div style={labelSm}>Description (SI)</div><input value={course.menu_si?.sub || ""} onChange={e => updMenu("si", "sub", e.target.value)} style={inpSm} placeholder="Slovenian desc" /></div>
          </div>

          {/* Metadata */}
          <div style={{ marginBottom: 12 }}>
            <div style={labelSm}>Course Key</div>
            <input value={course.course_key || ""} onChange={e => upd("course_key", e.target.value)} style={inpSm} placeholder="e.g. chicken_dessert" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={labelSm}>Category</div>
            <select value={category} onChange={e => upd("course_category", e.target.value)} style={inpSm}>
              <option value="main">main</option>
              <option value="optional">optional</option>
              <option value="celebration">celebration</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={labelSm}>Optional Pairing</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={optionalPairingEnabled}
                  onChange={e => {
                    const enabled = e.target.checked;
                    const next = { ...course, optional_pairing_enabled: enabled };
                    if (enabled && !String(next.optional_pairing_flag || "").trim()) {
                      next.optional_pairing_flag = String(next.course_key || "").trim();
                    }
                    if (enabled && !String(next.optional_pairing_label || "").trim()) {
                      next.optional_pairing_label = String(next.menu?.name || next.course_key || "").trim();
                    }
                    onUpdate(next);
                  }}
                />
                Enabled
              </label>
              <label style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={course.optional_pairing_default_on !== false}
                  disabled={!optionalPairingEnabled}
                  onChange={e => upd("optional_pairing_default_on", e.target.checked)}
                />
                Default ON
              </label>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={!!course.show_on_short} onChange={e => upd("show_on_short", e.target.checked)} />
              Show on Short
            </label>
            {isOptional && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: "#9a6020" }}>type:</span>
                <select
                  value={course.optional_flag || ""}
                  onChange={e => upd("optional_flag", e.target.value)}
                  style={{ ...inpSm, fontSize: 9, padding: "3px 6px" }}
                >
                  <option value="">(required key)</option>
                </select>
                <input value={course.optional_flag || ""} onChange={e => upd("optional_flag", e.target.value)}
                  style={{ ...inpSm, width: 140, fontSize: 9 }} placeholder="e.g. cheese" />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Optional pairing key:</span>
              <input value={course.optional_pairing_flag || ""} onChange={e => upd("optional_pairing_flag", e.target.value)} style={{ ...inpSm, width: 170 }} placeholder="e.g. crayfish_pairing" disabled={!optionalPairingEnabled} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Drink label:</span>
              <input value={course.optional_pairing_label || ""} onChange={e => upd("optional_pairing_label", e.target.value)} style={{ ...inpSm, width: 200 }} placeholder="e.g. Crayfish Martini" disabled={!optionalPairingEnabled} />
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#bbb" }}>shown in service UI</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>
          {optionalPairingEnabled && (
            <div style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid #f0d8d8", borderRadius: 4, background: "#fff8f8" }}>
              <div style={{ ...labelSm, marginBottom: 6, color: "#a04a4a" }}>Optional Pairing Text (course-owned)</div>
              <div style={{ display: "grid", gridTemplateColumns: "66px 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 5, alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: "#a04a4a", fontWeight: 600 }}>ALCO</span>
                <input value={course.optional_pairing_alco?.name || ""} onChange={e => upd("optional_pairing_alco", { ...(course.optional_pairing_alco || {}), name: e.target.value })} style={inpSm} placeholder="Name (EN)" />
                <input value={course.optional_pairing_alco?.sub || ""} onChange={e => upd("optional_pairing_alco", { ...(course.optional_pairing_alco || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (EN)" />
                <input value={course.optional_pairing_alco_si?.name || ""} onChange={e => upd("optional_pairing_alco_si", { ...(course.optional_pairing_alco_si || {}), name: e.target.value })} style={inpSm} placeholder="Name (SI)" />
                <input value={course.optional_pairing_alco_si?.sub || ""} onChange={e => upd("optional_pairing_alco_si", { ...(course.optional_pairing_alco_si || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (SI)" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "66px 1fr 1fr 1fr 1fr", gap: 6, alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: "#a04a4a", fontWeight: 600 }}>N/A</span>
                <input value={course.optional_pairing_na?.name || ""} onChange={e => upd("optional_pairing_na", { ...(course.optional_pairing_na || {}), name: e.target.value })} style={inpSm} placeholder="Name (EN)" />
                <input value={course.optional_pairing_na?.sub || ""} onChange={e => upd("optional_pairing_na", { ...(course.optional_pairing_na || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (EN)" />
                <input value={course.optional_pairing_na_si?.name || ""} onChange={e => upd("optional_pairing_na_si", { ...(course.optional_pairing_na_si || {}), name: e.target.value })} style={inpSm} placeholder="Name (SI)" />
                <input value={course.optional_pairing_na_si?.sub || ""} onChange={e => upd("optional_pairing_na_si", { ...(course.optional_pairing_na_si || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (SI)" />
              </div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#8f6f6f", marginTop: 7 }}>
                Auto mode: Wine / Premium / Our Story {"=>"} ALCO, Non-Alc {"=>"} N/A.
              </div>
            </div>
          )}

          {/* Pairings */}
          {activePairings.length > 0 && (
            <>
              <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>PAIRINGS</div>
              {activePairings.map(({ key, label }) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr 20px", gap: 6, marginBottom: 4, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: "#c8a06e", fontWeight: 600 }}>{label}</span>
                  <input value={course[key]?.name || ""} onChange={e => updPairing(key, "en", "name", e.target.value)} style={inpSm} placeholder="Name (EN)" />
                  <input value={course[key]?.sub || ""} onChange={e => updPairing(key, "en", "sub", e.target.value)} style={inpSm} placeholder="Sub (EN)" />
                  <input value={course[`${key}_si`]?.name || ""} onChange={e => updPairing(key, "si", "name", e.target.value)} style={inpSm} placeholder="Name (SI)" />
                  <input value={course[`${key}_si`]?.sub || ""} onChange={e => updPairing(key, "si", "sub", e.target.value)} style={inpSm} placeholder="Sub (SI)" />
                  <button onClick={() => removePairing(key)} title="Remove pairing" style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 14, padding: 0, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#e07070"}
                    onMouseLeave={e => e.currentTarget.style.color = "#ddd"}>×</button>
                </div>
              ))}
            </>
          )}

          {/* Dietary Restrictions */}
          {activeRestrictions.length > 0 && (
            <>
              <div style={{ ...labelSm, marginBottom: 4, fontSize: 9, letterSpacing: 2, color: "#888" }}>DIETARY RESTRICTIONS</div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr 1fr 20px", gap: 6, marginBottom: 3, alignItems: "center" }}>
                <span />
                <span style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", letterSpacing: 1 }}>NAME (EN)</span>
                <span style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", letterSpacing: 1 }}>DESC (EN)</span>
                <span style={{ fontFamily: FONT, fontSize: 8, color: "#4a7ab0", letterSpacing: 1 }}>NAME (SI)</span>
                <span style={{ fontFamily: FONT, fontSize: 8, color: "#4a7ab0", letterSpacing: 1 }}>DESC (SI)</span>
                <span style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", letterSpacing: 1 }}>KITCHEN NOTE</span>
                <span />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                {activeRestrictions.map(rKey => {
                  const val = course.restrictions?.[rKey];
                  const valSi = course.restrictions?.[`${rKey}_si`];
                  return (
                    <div key={rKey} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr 1fr 20px", gap: 6, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT, fontSize: 9, color: "#b04040" }}>{rKey.replace(/_/g, " ")}</span>
                      <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder={course.menu?.name || "Alt name"} />
                      <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder={course.menu?.sub || "Alt desc"} />
                      <input value={valSi?.name || ""} onChange={e => updRestrictionSi(rKey, "name", e.target.value)} style={{ ...inpSm, borderColor: "#c0d4e8" }} placeholder={course.menu_si?.name || "Slov. ime"} />
                      <input value={valSi?.sub || ""} onChange={e => updRestrictionSi(rKey, "sub", e.target.value)} style={{ ...inpSm, borderColor: "#c0d4e8" }} placeholder={course.menu_si?.sub || "Slov. opis"} />
                      <input value={val?.kitchen_note || ""} onChange={e => updRestriction(rKey, "kitchen_note", e.target.value)} style={inpSm} placeholder="Kitchen note" />
                      <button onClick={() => removeRestriction(rKey)} title="Remove restriction" style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 14, padding: 0, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#e07070"}
                        onMouseLeave={e => e.currentTarget.style.color = "#ddd"}>×</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Actions — add restriction / add pairing / delete */}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f0f0", paddingTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            {availableRestrictions.length > 0 && (
              <select
                value=""
                onChange={e => { addRestriction(e.target.value); e.target.value = ""; }}
                style={{ ...inpSm, fontSize: 9, color: "#b04040", borderColor: "#f0cccc", cursor: "pointer", minWidth: 140 }}
              >
                <option value="" disabled>+ Add restriction…</option>
                {availableRestrictions.map(rKey => (
                  <option key={rKey} value={rKey}>{rKey.replace(/_/g, " ")}</option>
                ))}
              </select>
            )}
            {availablePairings.length > 0 && (
              <select
                value=""
                onChange={e => { addPairing(e.target.value); e.target.value = ""; }}
                style={{ ...inpSm, fontSize: 9, color: "#c8a06e", borderColor: "#e8d8b8", cursor: "pointer", minWidth: 120 }}
              >
                <option value="" disabled>+ Add pairing…</option>
                {availablePairings.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onDelete} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
              border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
              background: "#fff9f9", color: "#c04040",
            }}>DELETE COURSE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CourseEditorPanel ─────────────────────────────────────────────────────────
export default function CourseEditorPanel({ menuCourses = [], onUpdateCourses, onSaveCourses }) {
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    await onSaveCourses(menuCourses);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const updateCourse = (position, updated) =>
    onUpdateCourses(menuCourses.map(c => c.position === position ? updated : c));

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
      menu: { name: "", sub: "" }, menu_si: null,
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
      kitchen_note: "", aperitif_btn: null, restrictions: {},
    };
    onUpdateCourses([...menuCourses, newCourse]);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>
          {menuCourses.filter(c => (c.course_category || "main") === "main").length} MAIN
          {menuCourses.filter(c => (c.course_category || "main") === "optional").length > 0 && (
            <span style={{ color: "#c8a06e", marginLeft: 8 }}>
              + {menuCourses.filter(c => (c.course_category || "main") === "optional").length} OPTIONAL
            </span>
          )}
          {menuCourses.filter(c => (c.course_category || "main") === "celebration").length > 0 && (
            <span style={{ color: "#a06ec8", marginLeft: 8 }}>
              + {menuCourses.filter(c => (c.course_category || "main") === "celebration").length} CELEBRATION
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={addCourse} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
            background: "#1a1a1a", color: "#fff",
          }}>+ ADD COURSE</button>
          <button onClick={handleSave} disabled={saving} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${saved ? "#4a9a6a" : "#c8a06e"}`, borderRadius: 2,
            cursor: saving ? "default" : "pointer",
            background: saved ? "#4a9a6a" : "#c8a06e", color: "#fff",
          }}>{saving ? "SAVING..." : saved ? "SAVED" : "SAVE ALL COURSES"}</button>
        </div>
      </div>

      {menuCourses.map((course, idx) => (
        <CourseCard
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
