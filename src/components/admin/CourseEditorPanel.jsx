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

// ── AddItemPopover ────────────────────────────────────────────────────────────
function AddItemPopover({ course, onUpdate, onClose }) {
  const [mode, setMode] = useState(null);
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };

  const addRestriction = (rKey) => {
    if (course.restrictions?.[rKey] != null) return;
    const restrictions = { ...course.restrictions, [rKey]: { name: "", sub: "", kitchen_note: "" } };
    onUpdate({ ...course, restrictions });
    onClose();
  };

  const addPairing = (pairingKey) => {
    if (course[pairingKey] != null) return;
    onUpdate({ ...course, [pairingKey]: { name: "", sub: "" } });
    onClose();
  };

  const availableRestrictions = DIETARY_KEYS.filter(rKey =>
    course.restrictions?.[rKey] == null
  );

  const availablePairings = PAIRING_KEYS.filter(({ key }) =>
    course[key] == null
  );

  if (!mode) {
    return (
      <div style={{
        position: "absolute", top: "100%", right: 0, zIndex: 10,
        background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "8px 0", minWidth: 160,
      }}>
        <button onClick={() => setMode("restriction")} style={{
          display: "block", width: "100%", textAlign: "left", padding: "8px 16px",
          fontFamily: FONT, fontSize: 10, border: "none", background: "none",
          cursor: "pointer", color: "#b04040",
        }}>+ Add Restriction</button>
        <button onClick={() => setMode("pairing")} style={{
          display: "block", width: "100%", textAlign: "left", padding: "8px 16px",
          fontFamily: FONT, fontSize: 10, border: "none", background: "none",
          cursor: "pointer", color: "#c8a06e",
        }}>+ Add Pairing</button>
        <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 4, paddingTop: 4 }}>
          <button onClick={onClose} style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 16px",
            fontFamily: FONT, fontSize: 9, border: "none", background: "none",
            cursor: "pointer", color: "#aaa",
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  if (mode === "restriction") {
    return (
      <div style={{
        position: "absolute", top: "100%", right: 0, zIndex: 10,
        background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "8px 0", minWidth: 180,
        maxHeight: 280, overflowY: "auto",
      }}>
        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", padding: "4px 16px 8px", textTransform: "uppercase" }}>
          Select Restriction
        </div>
        {availableRestrictions.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 10, color: "#ccc", padding: "8px 16px" }}>All restrictions already added</div>
        )}
        {availableRestrictions.map(rKey => (
          <button key={rKey} onClick={() => addRestriction(rKey)} style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 16px",
            fontFamily: FONT, fontSize: 10, border: "none", background: "none",
            cursor: "pointer", color: "#b04040",
          }}>{rKey.replace(/_/g, " ")}</button>
        ))}
        <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 4, paddingTop: 4 }}>
          <button onClick={() => setMode(null)} style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 16px",
            fontFamily: FONT, fontSize: 9, border: "none", background: "none",
            cursor: "pointer", color: "#aaa",
          }}>Back</button>
        </div>
      </div>
    );
  }

  if (mode === "pairing") {
    return (
      <div style={{
        position: "absolute", top: "100%", right: 0, zIndex: 10,
        background: "#fff", border: "1px solid #e0e0e0", borderRadius: 4,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "8px 0", minWidth: 160,
      }}>
        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", padding: "4px 16px 8px", textTransform: "uppercase" }}>
          Select Pairing
        </div>
        {availablePairings.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 10, color: "#ccc", padding: "8px 16px" }}>All pairings already added</div>
        )}
        {availablePairings.map(({ key, label }) => (
          <button key={key} onClick={() => addPairing(key)} style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 16px",
            fontFamily: FONT, fontSize: 10, border: "none", background: "none",
            cursor: "pointer", color: "#c8a06e",
          }}>{label}</button>
        ))}
        <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 4, paddingTop: 4 }}>
          <button onClick={() => setMode(null)} style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 16px",
            fontFamily: FONT, fontSize: 9, border: "none", background: "none",
            cursor: "pointer", color: "#aaa",
          }}>Back</button>
        </div>
      </div>
    );
  }

  return null;
}

// ── CourseCard — inline editor for a single course row ───────────────────────
function CourseCard({ course, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const [showAddPopover, setShowAddPopover] = useState(false);
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
    const current = restrictions[rKey] || { name: "", sub: "" };
    restrictions[rKey] = { ...current, [field]: value };
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

  const activeRestrictions = DIETARY_KEYS.filter(rKey =>
    course.restrictions?.[rKey] != null
  );

  const activePairings = PAIRING_KEYS.filter(({ key }) =>
    course[key] != null
  );

  const isOptional = !!(course.optional_flag || "").trim();

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
        {course.is_snack && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#c8a06e", border: "1px solid #e8d8b8", borderRadius: 2, padding: "2px 6px" }}>SNACK</span>}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Course Key</div><input value={course.course_key || ""} onChange={e => upd("course_key", e.target.value)} style={inpSm} placeholder="e.g. beetroot" /></div>
            <div><div style={labelSm}>Aperitif Btn</div><input value={course.aperitif_btn || ""} onChange={e => upd("aperitif_btn", e.target.value || null)} style={inpSm} placeholder="Button label" /></div>
          </div>

          {/* Toggles */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { key: "is_snack",           label: "Snack"         },
              { key: "section_gap_before", label: "Gap Before"    },
              { key: "show_on_short",      label: "Show on Short" },
            ].map(({ key, label }) => (
              <label key={key} style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={!!course[key]} onChange={e => upd(key, e.target.checked)} />
                {label}
              </label>
            ))}
            {/* Optional toggle */}
            <button
              onClick={() => upd("optional_flag", isOptional ? "" : "beetroot")}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                border: `1px solid ${isOptional ? "#d4a020" : "#ddd"}`,
                borderRadius: 2, cursor: "pointer",
                background: isOptional ? "#fff3d8" : "#fff",
                color: isOptional ? "#9a6020" : "#aaa",
              }}
            >{isOptional ? "OPTIONAL ✓" : "OPTIONAL"}</button>
            {isOptional && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: "#9a6020" }}>type:</span>
                <select
                  value={course.optional_flag || "beetroot"}
                  onChange={e => upd("optional_flag", e.target.value)}
                  style={{ ...inpSm, fontSize: 9, padding: "3px 6px" }}
                >
                  <option value="beetroot">Beetroot</option>
                  <option value="cheese">Cheese</option>
                  <option value="cake">Cake</option>
                  <option value="custom">Custom…</option>
                </select>
                {course.optional_flag === "custom" && (
                  <input value={course.optional_flag} onChange={e => upd("optional_flag", e.target.value)}
                    style={{ ...inpSm, width: 90, fontSize: 9 }} placeholder="flag name" />
                )}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>

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

          {/* Force Pairing */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Force Pairing (EN)</div><input value={course.force_pairing_title || ""} onChange={e => upd("force_pairing_title", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (EN)</div><input value={course.force_pairing_sub || ""} onChange={e => upd("force_pairing_sub", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Pairing (SI)</div><input value={course.force_pairing_title_si || ""} onChange={e => upd("force_pairing_title_si", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (SI)</div><input value={course.force_pairing_sub_si || ""} onChange={e => upd("force_pairing_sub_si", e.target.value)} style={inpSm} /></div>
          </div>

          {/* Dietary Restrictions */}
          {activeRestrictions.length > 0 && (
            <>
              <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DIETARY RESTRICTIONS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                {activeRestrictions.map(rKey => {
                  const val = course.restrictions?.[rKey];
                  return (
                    <div key={rKey} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 20px", gap: 6, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT, fontSize: 9, color: "#b04040" }}>{rKey.replace(/_/g, " ")}</span>
                      <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder={course.menu?.name || "Alt name"} />
                      <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder={course.menu?.sub || "Alt desc"} />
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

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f0f0", paddingTop: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowAddPopover(x => !x)} style={{
                fontFamily: FONT, fontSize: 11, padding: "6px 12px",
                border: "1px solid #4b4b88", borderRadius: 2, cursor: "pointer",
                background: showAddPopover ? "#4b4b88" : "#fff",
                color: showAddPopover ? "#fff" : "#4b4b88",
                fontWeight: 700,
              }}>+</button>
              {showAddPopover && (
                <AddItemPopover
                  course={course}
                  onUpdate={onUpdate}
                  onClose={() => setShowAddPopover(false)}
                />
              )}
            </div>
            <span style={{ fontFamily: FONT, fontSize: 9, color: "#aaa" }}>Add restriction or pairing</span>
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
      course_key: "", optional_flag: "", section_gap_before: false,
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
          {menuCourses.filter(c => !c.optional_flag).length} COURSES
          {menuCourses.filter(c => c.optional_flag).length > 0 && (
            <span style={{ color: "#c8a06e", marginLeft: 8 }}>
              + {menuCourses.filter(c => c.optional_flag).length} OPTIONAL
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
