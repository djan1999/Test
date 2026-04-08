import { useState } from "react";
import { DIETARY_KEYS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };

export default function CourseEditor({ course, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
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
    const current = restrictions[rKey] || { name: "", sub: "" };
    restrictions[rKey] = { ...current, [field]: value };
    if (!restrictions[rKey].name && !restrictions[rKey].sub) restrictions[rKey] = null;
    onUpdate({ ...course, restrictions });
  };

  return (
    <div style={{
      border: "1px solid #e8e8e8", borderRadius: 4, background: "#fff",
      marginBottom: 8, overflow: "hidden",
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? "#fafafa" : "#fff",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 10, color: "#bbb", minWidth: 22 }}>{course.position}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{course.menu?.name || "(unnamed)"}</span>
          {course.menu?.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginLeft: 8 }}>{course.menu.sub}</span>}
        </div>
        {course.is_snack && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#c8a06e", border: "1px solid #e8d8b8", borderRadius: 2, padding: "2px 6px" }}>SNACK</span>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", color: isFirst ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▲</button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", color: isLast ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▼</button>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 14, color: "#ccc", transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {expanded && (
        <div style={{ padding: "12px 14px 16px", borderTop: "1px solid #f0f0f0" }}>
          {/* ── Dish Info ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DISH INFO</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Name (EN)</div><input value={course.menu?.name || ""} onChange={e => updMenu("en", "name", e.target.value)} style={inpSm} placeholder="Dish name" /></div>
            <div><div style={labelSm}>Description (EN)</div><input value={course.menu?.sub || ""} onChange={e => updMenu("en", "sub", e.target.value)} style={inpSm} placeholder="ingredients, description" /></div>
            <div><div style={labelSm}>Name (SI)</div><input value={course.menu_si?.name || ""} onChange={e => updMenu("si", "name", e.target.value)} style={inpSm} placeholder="Slovenian name" /></div>
            <div><div style={labelSm}>Description (SI)</div><input value={course.menu_si?.sub || ""} onChange={e => updMenu("si", "sub", e.target.value)} style={inpSm} placeholder="Slovenian desc" /></div>
          </div>

          {/* ── Metadata ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Course Key</div><input value={course.course_key || ""} onChange={e => upd("course_key", e.target.value)} style={inpSm} placeholder="e.g. beetroot" /></div>
            <div><div style={labelSm}>Optional Flag</div><input value={course.optional_flag || ""} onChange={e => upd("optional_flag", e.target.value)} style={inpSm} placeholder="e.g. beetroot" /></div>
            <div><div style={labelSm}>Kitchen Note</div><input value={course.kitchen_note || ""} onChange={e => upd("kitchen_note", e.target.value)} style={inpSm} placeholder="Note for kitchen" /></div>
            <div><div style={labelSm}>Aperitif Btn</div><input value={course.aperitif_btn || ""} onChange={e => upd("aperitif_btn", e.target.value || null)} style={inpSm} placeholder="Button label" /></div>
          </div>

          {/* ── Toggles ── */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { key: "is_snack", label: "Snack" },
              { key: "show_on_short", label: "Show on Short" },
            ].map(({ key, label }) => (
              <label key={key} style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={!!course[key]} onChange={e => upd(key, e.target.checked)} />
                {label}
              </label>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>

          {/* ── Pairings ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>PAIRINGS</div>
          {[
            { key: "wp", label: "Wine" },
            { key: "na", label: "Non-Alc" },
            { key: "os", label: "Our Story" },
            { key: "premium", label: "Premium" },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#c8a06e", fontWeight: 600 }}>{label}</span>
              <input value={course[key]?.name || ""} onChange={e => updPairing(key, "en", "name", e.target.value)} style={inpSm} placeholder="Name (EN)" />
              <input value={course[key]?.sub || ""} onChange={e => updPairing(key, "en", "sub", e.target.value)} style={inpSm} placeholder="Sub (EN)" />
              <input value={course[`${key}_si`]?.name || ""} onChange={e => updPairing(key, "si", "name", e.target.value)} style={inpSm} placeholder="Name (SI)" />
              <input value={course[`${key}_si`]?.sub || ""} onChange={e => updPairing(key, "si", "sub", e.target.value)} style={inpSm} placeholder="Sub (SI)" />
            </div>
          ))}

          {/* ── Force Pairing ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Force Pairing (EN)</div><input value={course.force_pairing_title || ""} onChange={e => upd("force_pairing_title", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (EN)</div><input value={course.force_pairing_sub || ""} onChange={e => upd("force_pairing_sub", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Pairing (SI)</div><input value={course.force_pairing_title_si || ""} onChange={e => upd("force_pairing_title_si", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (SI)</div><input value={course.force_pairing_sub_si || ""} onChange={e => upd("force_pairing_sub_si", e.target.value)} style={inpSm} /></div>
          </div>

          {/* ── Restrictions ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DIETARY RESTRICTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
            {DIETARY_KEYS.map(rKey => {
              const val = course.restrictions?.[rKey];
              const hasVal = val && (val.name || val.sub);
              return (
                <div key={rKey} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 6, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: hasVal ? "#b04040" : "#ccc" }}>{rKey.replace(/_/g, " ")}</span>
                  <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder="Alt name" />
                  <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder="Alt desc" />
                </div>
              );
            })}
          </div>

          {/* ── Actions ── */}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
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
