import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
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
  const labelSm = { fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.text.muted, textTransform: "uppercase", marginBottom: 2 };

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
  const isActive = course.is_active !== false;

  return (
    <div style={{
      border: `1px solid ${isOptional ? tokens.neutral[300] : tokens.neutral[200]}`, borderRadius: tokens.radius,
      background: !isActive ? tokens.neutral[100] : (isOptional ? tokens.tint.parchment : tokens.surface.card),
      marginBottom: 8, overflow: "hidden",
      opacity: isActive ? 1 : 0.7,
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? tokens.surface.hover : "transparent",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.disabled, minWidth: 22 }}>{course.position}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.md, fontWeight: 700, color: tokens.text.primary }}>{course.menu?.name || "(unnamed)"}</span>
          {course.menu?.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, marginLeft: 8 }}>{course.menu.sub}</span>}
        </div>
        {!isActive && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.neutral[700], background: tokens.neutral[200], border: `1px solid ${tokens.neutral[400]}`, borderRadius: tokens.radius, padding: "2px 6px" }}>ARCHIVED</span>}
        {isOptional && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.neutral[700], background: tokens.tint.parchment, border: `1px solid ${tokens.neutral[300]}`, borderRadius: tokens.radius, padding: "2px 6px" }}>OPTIONAL · {course.optional_flag}</span>}
        {activeRestrictions.length > 0 && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.red.text, border: `1px solid ${tokens.red.border}`, borderRadius: tokens.radius, padding: "2px 6px" }}>{activeRestrictions.length}R</span>}
        {activePairings.length > 0 && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.charcoal.default, border: `1px solid ${tokens.neutral[300]}`, borderRadius: tokens.radius, padding: "2px 6px" }}>{activePairings.length}P</span>}
        <button
          onClick={e => { e.stopPropagation(); onUpdate({ ...course, is_active: !isActive }); }}
          title={isActive ? "Archive course (hide from ticket & menu generator)" : "Restore course"}
          style={{
            fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1,
            padding: "3px 8px", cursor: "pointer",
            border: `1px solid ${isActive ? tokens.green.border : tokens.neutral[400]}`,
            borderRadius: tokens.radius,
            background: isActive ? tokens.green.bg : tokens.neutral[100],
            color: isActive ? tokens.green.text : tokens.neutral[700],
          }}
        >{isActive ? "ACTIVE" : "INACTIVE"}</button>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", color: isFirst ? tokens.neutral[300] : tokens.text.muted, fontSize: tokens.fontSize.md, padding: "2px 4px" }}>▲</button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", color: isLast ? tokens.neutral[300] : tokens.text.muted, fontSize: tokens.fontSize.md, padding: "2px 4px" }}>▼</button>
        </div>
        <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.lg, color: tokens.neutral[300], transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {expanded && (
        <div style={{ padding: "12px 14px 16px", borderTop: tokens.border.subtle }}>
          {/* Dish Info */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.muted }}>DISH INFO</div>
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
              <label style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary, display: "flex", alignItems: "center", gap: 6 }}>
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
              <label style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary, display: "flex", alignItems: "center", gap: 6 }}>
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
            <label style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={!!course.show_on_short} onChange={e => upd("show_on_short", e.target.checked)} />
              Show on Short
            </label>
            {isOptional && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.neutral[700] }}>type:</span>
                <select
                  value={course.optional_flag || ""}
                  onChange={e => upd("optional_flag", e.target.value)}
                  style={{ ...inpSm, fontSize: tokens.fontSize.sm, padding: "3px 6px" }}
                >
                  <option value="">(required key)</option>
                </select>
                <input value={course.optional_flag || ""} onChange={e => upd("optional_flag", e.target.value)}
                  style={{ ...inpSm, width: 140, fontSize: tokens.fontSize.sm }} placeholder="e.g. cheese" />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary }}>Optional pairing key:</span>
              <input value={course.optional_pairing_flag || ""} onChange={e => upd("optional_pairing_flag", e.target.value)} style={{ ...inpSm, width: 170 }} placeholder="e.g. crayfish_pairing" disabled={!optionalPairingEnabled} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary }}>Drink label:</span>
              <input value={course.optional_pairing_label || ""} onChange={e => upd("optional_pairing_label", e.target.value)} style={{ ...inpSm, width: 200 }} placeholder="e.g. Crayfish Martini" disabled={!optionalPairingEnabled} />
              <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.text.disabled }}>shown in service UI</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>
          {optionalPairingEnabled && (
            <div style={{ marginBottom: 12, padding: "8px 10px", border: tokens.border.danger, borderRadius: tokens.radius, background: tokens.red.bg }}>
              <div style={{ ...labelSm, marginBottom: 6, color: tokens.red.text }}>Optional Pairing Text (course-owned)</div>
              <div style={{ display: "grid", gridTemplateColumns: "66px 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 5, alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.red.text, fontWeight: 600 }}>ALCO</span>
                <input value={course.optional_pairing_alco?.name || ""} onChange={e => upd("optional_pairing_alco", { ...(course.optional_pairing_alco || {}), name: e.target.value })} style={inpSm} placeholder="Name (EN)" />
                <input value={course.optional_pairing_alco?.sub || ""} onChange={e => upd("optional_pairing_alco", { ...(course.optional_pairing_alco || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (EN)" />
                <input value={course.optional_pairing_alco_si?.name || ""} onChange={e => upd("optional_pairing_alco_si", { ...(course.optional_pairing_alco_si || {}), name: e.target.value })} style={inpSm} placeholder="Name (SI)" />
                <input value={course.optional_pairing_alco_si?.sub || ""} onChange={e => upd("optional_pairing_alco_si", { ...(course.optional_pairing_alco_si || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (SI)" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "66px 1fr 1fr 1fr 1fr", gap: 6, alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.red.text, fontWeight: 600 }}>N/A</span>
                <input value={course.optional_pairing_na?.name || ""} onChange={e => upd("optional_pairing_na", { ...(course.optional_pairing_na || {}), name: e.target.value })} style={inpSm} placeholder="Name (EN)" />
                <input value={course.optional_pairing_na?.sub || ""} onChange={e => upd("optional_pairing_na", { ...(course.optional_pairing_na || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (EN)" />
                <input value={course.optional_pairing_na_si?.name || ""} onChange={e => upd("optional_pairing_na_si", { ...(course.optional_pairing_na_si || {}), name: e.target.value })} style={inpSm} placeholder="Name (SI)" />
                <input value={course.optional_pairing_na_si?.sub || ""} onChange={e => upd("optional_pairing_na_si", { ...(course.optional_pairing_na_si || {}), sub: e.target.value })} style={inpSm} placeholder="Sub (SI)" />
              </div>
              <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.red.text, marginTop: 7 }}>
                Auto mode: Wine / Premium / Our Story {"=>"} ALCO, Non-Alc {"=>"} N/A.
              </div>
            </div>
          )}

          {/* Pairings */}
          {activePairings.length > 0 && (
            <>
              <div style={{ ...labelSm, marginBottom: 6, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.muted }}>PAIRINGS</div>
              {activePairings.map(({ key, label }) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr 20px", gap: 6, marginBottom: 4, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.charcoal.default, fontWeight: 600 }}>{label}</span>
                  <input value={course[key]?.name || ""} onChange={e => updPairing(key, "en", "name", e.target.value)} style={inpSm} placeholder="Name (EN)" />
                  <input value={course[key]?.sub || ""} onChange={e => updPairing(key, "en", "sub", e.target.value)} style={inpSm} placeholder="Sub (EN)" />
                  <input value={course[`${key}_si`]?.name || ""} onChange={e => updPairing(key, "si", "name", e.target.value)} style={inpSm} placeholder="Name (SI)" />
                  <input value={course[`${key}_si`]?.sub || ""} onChange={e => updPairing(key, "si", "sub", e.target.value)} style={inpSm} placeholder="Sub (SI)" />
                  <button onClick={() => removePairing(key)} title="Remove pairing" style={{ background: "none", border: "none", cursor: "pointer", color: tokens.neutral[300], fontSize: tokens.fontSize.lg, padding: 0, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = tokens.red.text}
                    onMouseLeave={e => e.currentTarget.style.color = tokens.neutral[300]}>×</button>
                </div>
              ))}
            </>
          )}

          {/* Dietary Restrictions */}
          {activeRestrictions.length > 0 && (
            <>
              <div style={{ ...labelSm, marginBottom: 4, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.muted }}>DIETARY RESTRICTIONS</div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr 1fr 20px", gap: 6, marginBottom: 3, alignItems: "center" }}>
                <span />
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, color: tokens.text.disabled, letterSpacing: 1 }}>NAME (EN)</span>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, color: tokens.text.disabled, letterSpacing: 1 }}>DESC (EN)</span>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, color: tokens.text.secondary, letterSpacing: 1 }}>NAME (SI)</span>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, color: tokens.text.secondary, letterSpacing: 1 }}>DESC (SI)</span>
                <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, color: tokens.text.disabled, letterSpacing: 1 }}>KITCHEN NOTE</span>
                <span />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
                {activeRestrictions.map(rKey => {
                  const val = course.restrictions?.[rKey];
                  const valSi = course.restrictions?.[`${rKey}_si`];
                  return (
                    <div key={rKey} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr 1fr 20px", gap: 6, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.red.text }}>{rKey.replace(/_/g, " ")}</span>
                      <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder={course.menu?.name || "Alt name"} />
                      <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder={course.menu?.sub || "Alt desc"} />
                      <input value={valSi?.name || ""} onChange={e => updRestrictionSi(rKey, "name", e.target.value)} style={{ ...inpSm, borderColor: tokens.neutral[300] }} placeholder={course.menu_si?.name || "Slov. ime"} />
                      <input value={valSi?.sub || ""} onChange={e => updRestrictionSi(rKey, "sub", e.target.value)} style={{ ...inpSm, borderColor: tokens.neutral[300] }} placeholder={course.menu_si?.sub || "Slov. opis"} />
                      <input value={val?.kitchen_note || ""} onChange={e => updRestriction(rKey, "kitchen_note", e.target.value)} style={inpSm} placeholder="Kitchen note" />
                      <button onClick={() => removeRestriction(rKey)} title="Remove restriction" style={{ background: "none", border: "none", cursor: "pointer", color: tokens.neutral[300], fontSize: tokens.fontSize.lg, padding: 0, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = tokens.red.text}
                        onMouseLeave={e => e.currentTarget.style.color = tokens.neutral[300]}>×</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Actions — add restriction / add pairing / delete */}
          <div style={{ display: "flex", gap: 8, borderTop: tokens.border.subtle, paddingTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            {availableRestrictions.length > 0 && (
              <select
                value=""
                onChange={e => { addRestriction(e.target.value); e.target.value = ""; }}
                style={{ ...inpSm, fontSize: tokens.fontSize.sm, color: tokens.red.text, borderColor: tokens.red.border, cursor: "pointer", minWidth: 140 }}
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
                style={{ ...inpSm, fontSize: tokens.fontSize.sm, color: tokens.charcoal.default, borderColor: tokens.neutral[300], cursor: "pointer", minWidth: 120 }}
              >
                <option value="" disabled>+ Add pairing…</option>
                {availablePairings.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onDelete} style={{
              fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
              border: tokens.border.danger, borderRadius: tokens.radius, cursor: "pointer",
              background: tokens.red.bg, color: tokens.red.text,
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
  const [saveError, setSaveError] = useState(null);
  const [migrationWarning, setMigrationWarning] = useState(false);
  const [showArchived, setShowArchived] = useState(true);

  const handleSave = async () => {
    setSaving(true); setSaved(false); setSaveError(null);
    const result = await onSaveCourses(menuCourses);
    setSaving(false);
    if (result && result.ok === false) {
      setSaveError(result.error?.message || "Save failed — see console for details");
      return;
    }
    setMigrationWarning(!!(result && result.isActiveSkipped));
    setSaved(true);
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
      kitchen_note: "", aperitif_btn: null, is_active: true, restrictions: {},
    };
    onUpdateCourses([...menuCourses, newCourse]);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, letterSpacing: 1 }}>
          {menuCourses.filter(c => (c.course_category || "main") === "main").length} MAIN
          {menuCourses.filter(c => (c.course_category || "main") === "optional").length > 0 && (
            <span style={{ color: tokens.charcoal.default, marginLeft: 8 }}>
              + {menuCourses.filter(c => (c.course_category || "main") === "optional").length} OPTIONAL
            </span>
          )}
          {menuCourses.filter(c => (c.course_category || "main") === "celebration").length > 0 && (
            <span style={{ color: tokens.neutral[500], marginLeft: 8 }}>
              + {menuCourses.filter(c => (c.course_category || "main") === "celebration").length} CELEBRATION
            </span>
          )}
          {menuCourses.filter(c => c.is_active === false).length > 0 && (
            <span style={{ color: tokens.neutral[500], marginLeft: 8 }}>
              · {menuCourses.filter(c => c.is_active === false).length} ARCHIVED
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {menuCourses.some(c => c.is_active === false) && (
            <button onClick={() => setShowArchived(v => !v)} style={{
              fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
              border: `1px solid ${tokens.neutral[300]}`, borderRadius: tokens.radius, cursor: "pointer",
              background: tokens.surface.card, color: tokens.text.muted,
            }}>{showArchived ? "HIDE ARCHIVED" : "SHOW ARCHIVED"}</button>
          )}
          <button onClick={addCourse} style={{
            fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius, cursor: "pointer",
            background: tokens.surface.card, color: tokens.text.primary,
          }}>+ ADD COURSE</button>
          <button onClick={handleSave} disabled={saving} style={{
            fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${saveError ? tokens.red.border : saved ? tokens.green.border : tokens.charcoal.default}`, borderRadius: tokens.radius,
            cursor: saving ? "default" : "pointer",
            background: tokens.surface.card, color: saveError ? tokens.red.text : saved ? tokens.green.text : tokens.text.primary,
          }}>{saving ? "SAVING..." : saveError ? "SAVE FAILED" : saved ? "SAVED" : "SAVE ALL COURSES"}</button>
        </div>
      </div>

      {saveError && (
        <div style={{
          fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.red.text,
          background: tokens.red.bg, border: tokens.border.danger, borderRadius: tokens.radius,
          padding: "8px 12px", marginBottom: 12,
        }}>Save failed: {saveError}</div>
      )}
      {migrationWarning && (
        <div style={{
          fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.text.body,
          background: tokens.tint.parchment, border: `1px solid ${tokens.neutral[300]}`, borderRadius: tokens.radius,
          padding: "8px 12px", marginBottom: 12, lineHeight: 1.5,
        }}>
          Saved, but the <code>menu_courses.is_active</code> column is missing in the database, so archiving won't persist.
          Run this in the Supabase SQL editor to enable it:
          <pre style={{ marginTop: 6, padding: "6px 8px", background: tokens.neutral[0], border: `1px solid ${tokens.neutral[200]}`, fontSize: tokens.fontSize.xs, overflowX: "auto" }}>alter table public.menu_courses add column if not exists is_active boolean not null default true;</pre>
        </div>
      )}

      {menuCourses.map((course, idx) => {
        if (!showArchived && course.is_active === false) return null;
        return (
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
        );
      })}

      {menuCourses.length === 0 && (
        <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.base, color: tokens.text.disabled, textAlign: "center", padding: "40px 0" }}>
          No courses yet — add your first course above
        </div>
      )}
    </div>
  );
}
