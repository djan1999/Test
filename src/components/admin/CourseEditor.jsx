import { useState } from "react";
import { DIETARY_KEYS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };

export default function CourseEditor({ course, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };
  const labelSm = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 2 };

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
    if (!restrictions[rKey].name && !restrictions[rKey].sub) restrictions[rKey] = null;
    onUpdate({ ...course, restrictions });
  };
  const category = String(course.course_category || "main");
  const isOptionalCategory = category === "optional" || category === "celebration";
  const hasOptionalPairing = !!course.optional_pairing_enabled;
  const hasPairingData = !!(
    course.wp?.name || course.wp?.sub ||
    course.na?.name || course.na?.sub ||
    course.os?.name || course.os?.sub ||
    course.premium?.name || course.premium?.sub
  );

  return (
    <div style={{
      border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, background: tokens.neutral[0],
      marginBottom: 8, overflow: "hidden",
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? tokens.ink.bg : tokens.neutral[0],
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[4], minWidth: 22 }}>{course.position}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.ink[0] }}>{course.menu?.name || "(unnamed)"}</span>
          {course.menu?.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginLeft: 8 }}>{course.menu.sub}</span>}
        </div>
        {course.is_snack && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.charcoal.default, border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "2px 6px" }}>SNACK</span>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", color: isFirst ? tokens.ink[4] : tokens.ink[3], fontSize: 12, padding: "2px 4px" }}>▲</button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", color: isLast ? tokens.ink[4] : tokens.ink[3], fontSize: 12, padding: "2px 4px" }}>▼</button>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 14, color: tokens.ink[4], transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {expanded && (
        <div style={{ padding: "12px 14px 16px", borderTop: `1px solid ${tokens.ink[4]}` }}>
          {/* ── Dish Info ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: tokens.ink[3] }}>DISH INFO</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Name (EN)</div><input value={course.menu?.name || ""} onChange={e => updMenu("en", "name", e.target.value)} style={inpSm} placeholder="Dish name" /></div>
            <div><div style={labelSm}>Description (EN)</div><input value={course.menu?.sub || ""} onChange={e => updMenu("en", "sub", e.target.value)} style={inpSm} placeholder="ingredients, description" /></div>
            <div><div style={labelSm}>Name (SI)</div><input value={course.menu_si?.name || ""} onChange={e => updMenu("si", "name", e.target.value)} style={inpSm} placeholder="Slovenian name" /></div>
            <div><div style={labelSm}>Description (SI)</div><input value={course.menu_si?.sub || ""} onChange={e => updMenu("si", "sub", e.target.value)} style={inpSm} placeholder="Slovenian desc" /></div>
          </div>

          {/* ── Metadata ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Course Key</div><input value={course.course_key || ""} onChange={e => upd("course_key", e.target.value)} style={inpSm} placeholder="e.g. chicken_dessert" /></div>
            <div>
              <div style={labelSm}>Category</div>
              <select value={category} onChange={e => upd("course_category", e.target.value)} style={inpSm}>
                <option value="main">main</option>
                <option value="optional">optional</option>
                <option value="celebration">celebration</option>
              </select>
            </div>
            <div><div style={labelSm}>Optional Flag</div><input value={course.optional_flag || ""} onChange={e => upd("optional_flag", e.target.value)} style={inpSm} placeholder="e.g. cheese" disabled={!isOptionalCategory} /></div>
            <div>
              <div style={labelSm}>Optional Pairing</div>
              <label style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!course.optional_pairing_enabled}
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
            </div>
            <div><div style={labelSm}>Optional Pairing Key</div><input value={course.optional_pairing_flag || ""} onChange={e => upd("optional_pairing_flag", e.target.value)} style={inpSm} placeholder="e.g. crayfish_pairing" disabled={!course.optional_pairing_enabled} /></div>
            <div><div style={labelSm}>Optional Pairing Label</div><input value={course.optional_pairing_label || ""} onChange={e => upd("optional_pairing_label", e.target.value)} style={inpSm} placeholder="e.g. Crayfish Pairing" disabled={!course.optional_pairing_enabled} /></div>
            <div><div style={labelSm}>Kitchen Note</div><input value={course.kitchen_note || ""} onChange={e => upd("kitchen_note", e.target.value)} style={inpSm} placeholder="Note for kitchen" /></div>
            <div><div style={labelSm}>Aperitif Btn</div><input value={course.aperitif_btn || ""} onChange={e => upd("aperitif_btn", e.target.value || null)} style={inpSm} placeholder="Button label" /></div>
          </div>
          {hasOptionalPairing && (
            <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[1], marginBottom: 12 }}>
              Optional pairing is course-owned. Menu generation auto-picks <strong>Alcoholic</strong> for Wine / Premium / Our Story pairings and <strong>Non-Alcoholic</strong> for Non-Alc pairing. Uses this course pairings in the active language.
            </div>
          )}
          {hasOptionalPairing && !hasPairingData && (
            <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2], marginBottom: 12 }}>
              Add pairing data below (WP/NA/OS/Premium). Optional pairing is only available when course pairing data exists.
            </div>
          )}

          {/* ── Toggles ── */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { key: "is_snack", label: "Snack" },
              { key: "show_on_short", label: "Show on Short" },
            ].map(({ key, label }) => (
              <label key={key} style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={!!course[key]} onChange={e => upd(key, e.target.checked)} />
                {label}
              </label>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>

          {/* ── Pairings ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: tokens.ink[3] }}>PAIRINGS</div>
          {[
            { key: "wp", label: "Wine" },
            { key: "na", label: "Non-Alc" },
            { key: "os", label: "Our Story" },
            { key: "premium", label: "Premium" },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.charcoal.default, fontWeight: 600 }}>{label}</span>
              <input value={course[key]?.name || ""} onChange={e => updPairing(key, "en", "name", e.target.value)} style={inpSm} placeholder="Name (EN)" />
              <input value={course[key]?.sub || ""} onChange={e => updPairing(key, "en", "sub", e.target.value)} style={inpSm} placeholder="Sub (EN)" />
              <input value={course[`${key}_si`]?.name || ""} onChange={e => updPairing(key, "si", "name", e.target.value)} style={inpSm} placeholder="Name (SI)" />
              <input value={course[`${key}_si`]?.sub || ""} onChange={e => updPairing(key, "si", "sub", e.target.value)} style={inpSm} placeholder="Sub (SI)" />
            </div>
          ))}

          {/* ── Restrictions ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: tokens.ink[3] }}>DIETARY RESTRICTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
            {DIETARY_KEYS.map(rKey => {
              const val = course.restrictions?.[rKey];
              const hasVal = val && (val.name || val.sub);
              return (
                <div key={rKey} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 6, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: hasVal ? tokens.red.text : tokens.ink[4] }}>{rKey.replace(/_/g, " ")}</span>
                  <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder="Alt name" />
                  <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder="Alt desc" />
                </div>
              );
            })}
          </div>

          {/* ── Actions ── */}
          <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 12 }}>
            <button onClick={onDelete} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
              border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
              background: tokens.red.bg, color: tokens.red.text,
            }}>DELETE COURSE</button>
          </div>
        </div>
      )}
    </div>
  );
}
