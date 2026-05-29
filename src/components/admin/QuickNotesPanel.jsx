import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT, baseInp, saveBtn, dangerBtn, primaryBtn } from "./adminStyles.js";

const courseKeyOf = (course) => course.course_key || course.menu?.name || course.position || "";
const courseLabelOf = (course) => course.menu?.name || course.course_key || `Course ${course.position ?? ""}`;

export default function QuickNotesPanel({ menuCourses = [], quickNotes = {}, onSave }) {
  const courses = useMemo(
    () => (menuCourses || []).filter(c => c && (c.menu?.name || c.course_key)),
    [menuCourses]
  );

  const [draft, setDraft] = useState(() => normalize(quickNotes));
  const [activeCourseKey, setActiveCourseKey] = useState(() => courseKeyOf(courses[0] || {}));
  const [newPreset, setNewPreset] = useState("");
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    setDraft(normalize(quickNotes));
  }, [quickNotes]);

  useEffect(() => {
    if (!activeCourseKey && courses.length > 0) {
      setActiveCourseKey(courseKeyOf(courses[0]));
    }
  }, [courses, activeCourseKey]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(normalize(quickNotes)), [draft, quickNotes]);

  const activePresets = draft[activeCourseKey] || [];

  const addPreset = () => {
    const text = newPreset.trim();
    if (!text || !activeCourseKey) return;
    const current = draft[activeCourseKey] || [];
    if (current.includes(text)) { setNewPreset(""); return; }
    setDraft(d => ({ ...d, [activeCourseKey]: [...current, text] }));
    setNewPreset("");
    setStatus("idle");
  };

  const updatePreset = (idx, value) => {
    setDraft(d => ({
      ...d,
      [activeCourseKey]: (d[activeCourseKey] || []).map((p, i) => i === idx ? value : p),
    }));
    setStatus("idle");
  };

  const removePreset = (idx) => {
    setDraft(d => ({
      ...d,
      [activeCourseKey]: (d[activeCourseKey] || []).filter((_, i) => i !== idx),
    }));
    setStatus("idle");
  };

  const save = async () => {
    setStatus("saving");
    const clean = {};
    Object.entries(draft).forEach(([k, list]) => {
      const filtered = (list || []).map(s => String(s || "").trim()).filter(Boolean);
      if (filtered.length > 0) clean[k] = filtered;
    });
    const result = await onSave(clean);
    if (result?.ok === false) { setStatus("error"); return; }
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  const labelStyle = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 4 };
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], background: tokens.ink.bg, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
        Pick a course on the left, then add the notes you write most often
        (e.g. "no croutons", "extra sauce"). Staff can apply them as chips on
        the reservation form — clicking a chip multiple times stacks the count
        (1×, 2×…) on the kitchen ticket.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14 }}>
        <div style={{ border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], maxHeight: 360, overflowY: "auto" }}>
          {courses.length === 0 && (
            <div style={{ padding: 12, fontSize: 10, color: tokens.ink[3], fontStyle: "italic" }}>
              No courses defined yet.
            </div>
          )}
          {courses.map(c => {
            const key = courseKeyOf(c);
            const active = key === activeCourseKey;
            const count = (draft[key] || []).length;
            return (
              <button
                key={key}
                onClick={() => setActiveCourseKey(key)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", padding: "8px 10px",
                  background: active ? tokens.green.bg : tokens.neutral[0],
                  border: "none",
                  borderBottom: `1px solid ${tokens.ink[4]}`,
                  fontFamily: FONT, fontSize: 11,
                  color: active ? tokens.green.text : tokens.ink[0],
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <span>{courseLabelOf(c)}</span>
                {count > 0 && (
                  <span style={{ fontSize: 9, color: tokens.ink[3] }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div>
          {activeCourseKey ? (
            <>
              <div style={labelStyle}>Presets for {courseLabelOf(courses.find(c => courseKeyOf(c) === activeCourseKey) || {})}</div>
              {activePresets.length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], fontStyle: "italic", padding: "6px 0 10px" }}>
                  No presets yet.
                </div>
              )}
              {activePresets.map((preset, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 8, marginBottom: 6 }}>
                  <input value={preset} onChange={(e) => updatePreset(idx, e.target.value)} style={inpSm} />
                  <button onClick={() => removePreset(idx)} style={dangerBtn}>REMOVE</button>
                </div>
              ))}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8, marginTop: 12 }}>
                <input
                  value={newPreset}
                  onChange={(e) => setNewPreset(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPreset(); } }}
                  placeholder="no croutons"
                  style={inpSm}
                />
                <button onClick={addPreset} disabled={!newPreset.trim()} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 10, opacity: newPreset.trim() ? 1 : 0.4 }}>
                  + ADD
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], fontStyle: "italic" }}>
              Select a course to define its quick notes.
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={save} disabled={!dirty || status === "saving"} style={{ ...saveBtn(status), opacity: dirty ? 1 : 0.5 }}>
          {status === "saving" ? "SAVING…" : status === "saved" ? "SAVED ✓" : status === "error" ? "ERROR" : "SAVE"}
        </button>
      </div>
    </div>
  );
}

function normalize(map) {
  if (!map || typeof map !== "object") return {};
  const out = {};
  Object.entries(map).forEach(([k, v]) => {
    if (Array.isArray(v)) out[k] = v.slice();
  });
  return out;
}
