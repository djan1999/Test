import { useEffect, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, MeasuringStrategy, rectIntersection, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { RESTRICTIONS, restrLabel } from "../../constants/dietary.js";
import { applyCourseRestriction, applyMenuOverride, RESTRICTION_COLUMN_MAP, RESTRICTION_PRIORITY_KEYS } from "../../utils/menuUtils.js";
import { fmt, parseHHMM } from "../../utils/tableHelpers.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

export function KitchenTicket({ table, menuCourses, upd, dragHandleRef, dragListeners }) {
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const log = table.kitchenLog || {};
  const [assigningRestrIdx, setAssigningRestrIdx] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [pickingRestr, setPickingRestr] = useState(null); // restriction key, or "custom"
  const [customNote, setCustomNote] = useState("");
  const [editingCourse, setEditingCourse] = useState(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");

  const kitchenCourseNotes = table.kitchenCourseNotes || {};
  const startEditCourse = (key) => {
    const curr = kitchenCourseNotes[key] || {};
    setEditName(curr.name || "");
    setEditNote(curr.note || "");
    setEditingCourse(key);
  };
  const saveCourseDraft = (key, name, note) => {
    const allNotes = { ...kitchenCourseNotes };
    const entry = {};
    if (name.trim()) entry.name = name.trim();
    if (note.trim()) entry.note = note.trim();
    if (Object.keys(entry).length) allNotes[key] = entry;
    else delete allNotes[key];
    upd(table.id, "kitchenCourseNotes", allNotes);
  };
  const clearCourseNote = (key) => {
    const allNotes = { ...kitchenCourseNotes };
    delete allNotes[key];
    upd(table.id, "kitchenCourseNotes", allNotes);
    setEditingCourse(null);
  };

  const addKitchenRestr = (note, seatId) => {
    if (!note?.trim()) return;
    // Seat-specific only. If no seat chosen yet, leave unassigned (pos: null).
    const next = [...restrictions, { note: note.trim(), pos: (seatId ?? null), kitchenAdded: true }];
    upd(table.id, "restrictions", next);
    setPickingRestr(null);
    setCustomNote("");
  };
  const removeKitchenRestr = (origIdx) => {
    const next = restrictions.filter((_, i) => i !== origIdx);
    upd(table.id, "restrictions", next);
  };

  const fire = (courseKey) => {
    const now = fmt(new Date());
    const newLog = { ...log, [courseKey]: { firedAt: now } };
    upd(table.id, "kitchenLog", newLog);
  };
  const unfire = (courseKey) => {
    const newLog = { ...log };
    delete newLog[courseKey];
    upd(table.id, "kitchenLog", newLog);
  };

  const assignRestrToSeat = (seatId) => {
    if (assigningRestrIdx === null) return;
    const updated = restrictions.map((r, i) =>
      i === assigningRestrIdx ? { ...r, pos: seatId } : r
    );
    upd(table.id, "restrictions", updated);
    setAssigningRestrIdx(null);
  };

  // Seat restriction keys per seat (for course substitution lookup).
  // Return raw r.note — applyCourseRestriction does its own RESTRICTION_COLUMN_MAP lookup internally.
  const seatRestrKeys = (seat) =>
    (restrictions || [])
      .filter(r => r.pos === seat.id)
      .map(r => r.note);

  const pairingColor = { Wine: "#7a5020", "Non-Alc": "#1f5f73", Premium: "#5a5a8a", "Our Story": "#3a7a5a" };
  const pairingBg   = { Wine: "#fdf4e8", "Non-Alc": "#e8f5fa", Premium: "#f0eeff", "Our Story": "#eaf5ee" };

  const normFlag = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const orderedOptionalSeatsByKey = (menuCourses || []).reduce((acc, course) => {
    const key = normFlag(course?.optional_flag);
    if (!key) return acc;
    acc[key] = seats.filter((s) => !!s.extras?.[key]?.ordered);
    return acc;
  }, {});
  const isForcedPairingCourse = c => !!String(c.force_pairing_title || c.force_pairing_title_si || "").trim();

  const optionalSeatsForCourse = (course) => {
    const key = normFlag(course?.optional_flag);
    if (!key) return [];
    return orderedOptionalSeatsByKey[key] || [];
  };

  const isShort = String(table.menuType || "").trim().toLowerCase() === "short";
  const isTruthyShort = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr"; };

  // Apply per-table course overrides on top of the (already globally-overridden) menuCourses
  const tableOverriddenCourses = (menuCourses || []).map(c => applyMenuOverride(c, table.courseOverrides || {}));

  // Courses to show: non-snack, optional extras only when ordered, short menu filtered
  const courses = tableOverriddenCourses.filter(c => {
    if (c.is_snack) return false;
    if (normFlag(c.optional_flag) && optionalSeatsForCourse(c).length === 0) return false;
    if (isShort && !isTruthyShort(c.show_on_short)) return false;
    return true;
  }).sort((a, b) => {
    if (isShort) return ((Number(a.short_order) || 9999) - (Number(b.short_order) || 9999));
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });

  const firedCount   = Object.keys(log).length;
  const totalCourses = courses.length; // extras are now included in courses

  // Duration: arrivedAt → last firedAt when all done
  const allDone = totalCourses > 0 && firedCount >= totalCourses;
  const lastFiredAt = allDone ? Object.values(log).map(e => e.firedAt).filter(Boolean).sort().pop() : null;
  const durationMins = (() => {
    const start = parseHHMM(table.arrivedAt), end = parseHHMM(lastFiredAt);
    if (start == null || end == null) return null;
    const d = end - start; return d >= 0 ? d : d + 1440;
  })();

  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p === "Wine" ? "Wine" : p;

  return (
    <div style={{ border: "2px solid #e8e8e8", borderRadius: 6, overflow: "hidden", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>

      {/* ── Header (drag handle) ── */}
      <div ref={dragHandleRef} {...dragListeners} style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: 8, cursor: dragListeners ? "grab" : undefined, touchAction: "none" }}>
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? 16 : 21, fontWeight: 800, color: "#111", lineHeight: 1, letterSpacing: -1, flexShrink: 0 }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.resName}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3, background: isShort ? "#fff4e0" : "#e8f0ff", color: isShort ? "#a06000" : "#2a50a0" }}>{isShort ? "SHORT" : "LONG"}</span>}
            <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3, background: table.lang === "si" ? "#fff0f0" : "#f0fff4", color: table.lang === "si" ? "#a03030" : "#207040", border: "1px solid", borderColor: table.lang === "si" ? "#f0c0c0" : "#b0dcc0" }}>{table.lang === "si" ? "SI" : "EN"}</span>
            {table.birthday && <span style={{ fontSize: 10 }}>🎂</span>}
            {table.guestType === "hotel" && <span style={{ fontFamily: FONT, fontSize: 8, color: "#9a6a20", letterSpacing: 0.5 }}>{table.room ? `#${table.room}` : "Hotel"}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111" }}>{seats.length} <span style={{ fontWeight: 600, fontSize: 10, letterSpacing: 0.5 }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#333" }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#4a9a6a" }}>arr. {table.arrivedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: allDone ? "#4a9a6a" : "#111", lineHeight: 1 }}>{firedCount}<span style={{ fontSize: 10, color: "#666", fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a" }}>{durationMins} min</div>}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setShowEdit(v => !v); setPickingRestr(null); setCustomNote(""); setEditingCourse(null); }}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "2px 7px",
              border: `1px solid ${showEdit ? "#1a1a1a" : "#ddd"}`,
              borderRadius: 3, cursor: "pointer",
              background: showEdit ? "#1a1a1a" : "#fff",
              color: showEdit ? "#fff" : "#888",
              touchAction: "manipulation",
            }}>✏ EDIT</button>
        </div>
      </div>

      {/* ── Notes banner ── */}
      {table.notes && (
        <div style={{ background: "#fffbe8", borderBottom: "1px solid #f0d878", padding: "5px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1.4 }}>📋</span>
          <span style={{ fontFamily: FONT, fontSize: 10, color: "#7a6010", lineHeight: 1.35, fontStyle: "italic" }}>{table.notes}</span>
        </div>
      )}

      {/* ── Temp restriction editor ── */}
      {showEdit && (
        <div style={{ borderBottom: "1px solid #e8e8e8", padding: "8px 10px", background: "#fafafa" }}>
          {/* Existing kitchen-added restrictions */}
          {restrictions.map((r, i) => r.kitchenAdded ? (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#b04040", fontWeight: 600 }}>
                {restrLabel(r.note)}{r.pos ? ` → P${r.pos}` : " → All"}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeKitchenRestr(i); }}
                style={{ fontFamily: FONT, fontSize: 10, padding: "1px 6px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", touchAction: "manipulation" }}>✕</button>
            </div>
          ) : null)}
          {/* Step 1: pick restriction */}
          {!pickingRestr && (
            <>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Add restriction</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RESTRICTIONS.map(r => (
                  <button key={r.key}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setPickingRestr(r.key); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #e0e0e0", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#444", touchAction: "manipulation" }}>
                    {r.emoji} {r.label}
                  </button>
                ))}
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setPickingRestr("custom"); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #e0e0e0", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#888", touchAction: "manipulation" }}>
                  + Custom
                </button>
              </div>
            </>
          )}
          {/* Step 2a: assign to seat */}
          {pickingRestr && pickingRestr !== "custom" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#444", marginBottom: 6 }}>
                {restrLabel(pickingRestr)} → assign to:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer", background: "#fdf4e8", color: "#7a5020", fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #eee", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#bbb", touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
          {/* Step 2b: custom text */}
          {pickingRestr === "custom" && (
            <div>
              <input
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="e.g. No Ricotta"
                onPointerDown={e => e.stopPropagation()}
                style={{ fontFamily: FONT, fontSize: 10, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 3, width: "100%", marginBottom: 6, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer", background: "#fdf4e8", color: "#7a5020", fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); setCustomNote(""); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #eee", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#bbb", touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pace ── */}
      <div style={{ borderBottom: "1px solid #e8e8e8", padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#888", textTransform: "uppercase", flexShrink: 0 }}>Pace</span>
        {["Slow", "Fast"].map(p => {
          const colors = { Slow: { on: "#7a5020", bg: "#fdf4e8", border: "#c8a060" }, Fast: { on: "#6a2a2a", bg: "#fdf0f0", border: "#d08888" } };
          const active = table.pace === p;
          const col = colors[p];
          return (
            <button key={p} onClick={() => upd && upd(table.id, "pace", active ? "" : p)} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "3px 10px",
              border: `1px solid ${active ? col.border : "#ececec"}`,
              borderRadius: 3, cursor: upd ? "pointer" : "default",
              background: active ? col.bg : "#fff", color: active ? col.on : "#ccc",
              transition: "all 0.1s",
            }}>{p}</button>
          );
        })}
      </div>

      {/* ── Seats ── */}
      <div style={{ background: "#f6f6f6", borderBottom: "1px solid #e8e8e8", padding: "5px 10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
          {seats.map(s => {
            const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
            const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
            const restrShort = k => { const d = RESTRICTIONS.find(r => r.key === k); return d ? d.label : k; };
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 2,
                  background: p ? (pairingBg[p] || "#f0f0f0") : "#e8e8e8",
                  color: p ? (pairingColor[p] || "#444") : "#444",
                }}>P{s.id}{p ? ` · ${pLabel(p)}` : ""}</span>
                {restrList.length > 0 && (
                  <span style={{ fontFamily: FONT, fontSize: 8, color: "#b03030", letterSpacing: 0.2, fontWeight: 600 }}>{restrList.map(restrShort).join(" · ")}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned restrictions — tap to assign to a seat */}
        {(() => {
          const unassigned = restrictions.map((r, i) => ({ ...r, _i: i })).filter(r => !r.pos && r.note);
          if (unassigned.length === 0) return null;
          return (
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px solid #e8e8e8" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#b04040", textTransform: "uppercase", flexShrink: 0 }}>⚠ Unassigned</span>
                {unassigned.map(r => (
                  <span
                    key={r._i}
                    onClick={() => setAssigningRestrIdx(assigningRestrIdx === r._i ? null : r._i)}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "2px 8px", borderRadius: 3,
                      border: "1px solid #e09090",
                      background: assigningRestrIdx === r._i ? "#b04040" : "#fef0f0",
                      color: assigningRestrIdx === r._i ? "#fff" : "#b04040",
                      fontWeight: 500, cursor: "pointer", userSelect: "none",
                    }}
                  >{restrLabel(r.note)} {assigningRestrIdx === r._i ? "→ pick seat" : "→"}</span>
                ))}
              </div>
              {assigningRestrIdx !== null && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: "#b04040", flexShrink: 0 }}>Assign to:</span>
                  {seats.map(s => (
                    <button key={s.id} onClick={() => assignRestrToSeat(s.id)} style={{
                      fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "3px 10px",
                      border: "1px solid #e09090", borderRadius: 3, cursor: "pointer",
                      background: "#fff", color: "#b04040",
                    }}>P{s.id}</button>
                  ))}
                  <button onClick={() => setAssigningRestrIdx(null)} style={{
                    fontFamily: FONT, fontSize: 9, padding: "3px 8px",
                    border: "1px solid #eee", borderRadius: 3, cursor: "pointer",
                    background: "#fff", color: "#bbb",
                  }}>cancel</button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Courses ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {courses.map((course, idx) => {
          const key = course.course_key || `course_${idx}`;
          const fired = !!log[key];
          const firedAt = log[key]?.firedAt;

          const baseName    = course.menu?.name || key;
          const baseSub     = course.menu?.sub  || "";
          const baseNameSi  = course.menu_si?.name || null;
          const baseSubSi   = course.menu_si?.sub  || "";
          const kitchenNote = (() => {
            const notes = new Set();
            seats.forEach(seat => {
              seatRestrKeys(seat).forEach(k => {
                const n = course.restrictions?.[k]?.kitchen_note;
                if (n?.trim()) notes.add(n.trim());
              });
            });
            return [...notes].join(" · ");
          })();
          const line1 = baseName;
          const subDiff = (modSub) => {
            const baseTokens = new Set(baseSub.split(/[,·]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
            const modTokens  = modSub.split(/[,·]+/).map(s => s.trim()).filter(Boolean);
            const newOnes    = modTokens.filter(t => !baseTokens.has(t.toLowerCase()));
            return newOnes.length > 0 ? newOnes[0] : modSub;
          };
          const allSeatDishes = seats.map(seat => {
            const restrKeys = seatRestrKeys(seat);
            if (restrKeys.length) {
              for (const key of RESTRICTION_PRIORITY_KEYS) {
                if (!restrKeys.includes(key)) continue;
                const mapped = RESTRICTION_COLUMN_MAP[key] || key;
                const note = course.restrictions?.[`${mapped}_note`];
                if (note) return note.toUpperCase();
              }
              const modified = applyCourseRestriction(course, restrKeys);
              if (modified) {
                if (modified.name !== baseName) return modified.name;
                if (modified.sub  !== baseSub)  return subDiff(modified.sub).toUpperCase();
              }
            }
            return baseName;
          });
          const anyMod = allSeatDishes.some(n => n !== baseName);
          const modGroups = (() => {
            if (!anyMod || fired) return null;
            const g = {};
            allSeatDishes.forEach(n => { g[n] = (g[n] || 0) + 1; });
            return g;
          })();
          const extraLabel = (() => {
            const optKey = optionalKeyForCourse(course);
            if (!optKey) return null;
            const marks = (optionalSeatMap[optKey] || []).map(s => `P${s.id}`).join(" ");
            return marks + ((optKey === "cake" && table.cakeNote) ? ` — ${table.cakeNote}` : "");
          })();

          const kcNote = kitchenCourseNotes[key] || {};
          const displayName = kcNote.name || line1;
          const isEditingThis = editingCourse === key;

          return (
            <div key={key} style={{
              borderBottom: "1px solid #f2f2f2",
              background: fired ? "#f3fcf5" : "#fff",
              borderLeft: fired ? "4px solid #4a9a6a" : kcNote.name || kcNote.note ? "4px solid #c04040" : "4px solid transparent",
            }}>
              <div
                onClick={() => !isEditingThis && (fired ? unfire(key) : fire(key))}
                style={{ display: "flex", alignItems: "center", padding: "7px 10px 7px 8px", gap: 7, cursor: isEditingThis ? "default" : "pointer" }}>
                <span style={{ fontFamily: FONT, fontSize: 13, color: fired ? "#4a9a6a" : "#ddd", flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                    color: fired ? "#bbb" : kcNote.name ? "#c04040" : "#111",
                    textDecoration: fired ? "line-through" : "none",
                    letterSpacing: 0.2,
                  }}>
                    {displayName}
                    {kcNote.name && <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 400, color: "#aaa", marginLeft: 5 }}>({line1})</span>}
                    {extraLabel && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 400, color: "#bbb", marginLeft: 6 }}>{extraLabel}</span>}
                  </div>
                  {(modGroups || kitchenNote || kcNote.note) && !fired && (
                    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {modGroups && Object.entries(modGroups).sort(([a], [b]) => (a === baseName ? -1 : 1) - (b === baseName ? -1 : 1)).map(([name, count]) => (
                        <span key={name} style={{ fontFamily: FONT, fontSize: 10, color: name === baseName ? "#444" : "#c04040", fontWeight: 600 }}>{count}× {name}</span>
                      ))}
                      {kitchenNote && <span style={{ fontFamily: FONT, fontSize: 10, color: "#c04040", fontWeight: 600 }}>{kitchenNote}</span>}
                      {kcNote.note && <span style={{ fontFamily: FONT, fontSize: 10, color: "#c04040", fontWeight: 600 }}>⚑ {kcNote.note}</span>}
                    </div>
                  )}
                </div>
                {showEdit && !fired && (
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); if (isEditingThis) { saveCourseDraft(key, editName, editNote); setEditingCourse(null); } else { startEditCourse(key); } }}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "2px 6px", flexShrink: 0,
                      border: `1px solid ${isEditingThis ? "#1a1a1a" : "#ddd"}`,
                      borderRadius: 3, cursor: "pointer",
                      background: isEditingThis ? "#1a1a1a" : "#fff",
                      color: isEditingThis ? "#fff" : "#aaa",
                      touchAction: "manipulation",
                    }}>✏</button>
                )}
                {firedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a", fontWeight: 700, flexShrink: 0 }}>{firedAt}</span>}
              </div>
              {/* Inline course editor */}
              {isEditingThis && (
                <div onPointerDown={e => e.stopPropagation()} style={{ padding: "0 10px 8px 28px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder={`Rename "${line1}"…`}
                    style={{ fontFamily: FONT, fontSize: 10, padding: "4px 7px", border: "1px solid #c04040", borderRadius: 3, width: "100%", boxSizing: "border-box" }}
                  />
                  <input
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder="Add note (e.g. No Ricotta)…"
                    style={{ fontFamily: FONT, fontSize: 10, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 3, width: "100%", boxSizing: "border-box" }}
                  />
                  {(kcNote.name || kcNote.note) && (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); clearCourseNote(key); }}
                      style={{ fontFamily: FONT, fontSize: 8, padding: "3px 8px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", alignSelf: "flex-start", touchAction: "manipulation" }}>Clear override</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Done footer ── */}
      {allDone && (() => {
        const fmtDuration = (mins) => {
          if (mins == null) return null;
          const h = Math.floor(mins / 60), m = mins % 60;
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };
        const timeRange = table.arrivedAt && lastFiredAt ? `${table.arrivedAt}–${lastFiredAt}` : null;
        const durLabel  = fmtDuration(durationMins);
        return (
          <div style={{ background: "#eaf7ee", borderTop: "2px solid #b8e8c4", padding: "7px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 13, color: "#4a9a6a" }}>✓</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {durLabel && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 700, letterSpacing: 0.5 }}>{durLabel}</span>}
                {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: "#6ab88a", letterSpacing: 0.3 }}>{timeRange}</span>}
                {!durLabel && !timeRange && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 700, letterSpacing: 1 }}>COMPLETE</span>}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); upd && upd(table.id, "kitchenArchived", true); }}
              style={{
                fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 10px",
                border: "1px solid #a8d8b8", borderRadius: 3, cursor: "pointer",
                background: "#fff", color: "#4a9a6a", textTransform: "uppercase",
              }}
            >Archive</button>
          </div>
        );
      })()}
    </div>
  );
}

export function SortableTicket({ table, menuCourses, upd, isDragging, anyDragging }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{
        flexShrink: 0, width: 248,
        // Only apply transform while a drag is active — prevents stale transforms
        // from persisting after drag ends and causing cards to appear displaced.
        transform: anyDragging && transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition: isDragging ? 'none' : (anyDragging ? transition : undefined),
        userSelect: "none", WebkitUserSelect: "none",
        touchAction: "pan-y",
      }}
    >
      {isDragging ? (
        // Ghost placeholder — dashed outline so the layout slot stays visible
        <div style={{
          width: 248, height: "100%", minHeight: 120,
          border: "2px dashed #d0e8d8", borderRadius: 6,
          background: "#f4fbf6",
        }} />
      ) : (
        <KitchenTicket table={table} menuCourses={menuCourses} upd={upd} dragHandleRef={setActivatorNodeRef} dragListeners={listeners} />
      )}
    </div>
  );
}

export function KitchenAlertOverlay({ alerts, onConfirm }) {
  if (alerts.length === 0) return null;
  const PAIR_COLORS = {
    Wine:      { color: "#7a5020", bg: "#fdf4e8", border: "#c8a060" },
    "Non-Alc": { color: "#1f5f73", bg: "#e8f7fb", border: "#7fc6db" },
    Premium:   { color: "#5a5a8a", bg: "#f0eeff", border: "#aaaacc" },
    "Our Story":{ color: "#3a7a5a", bg: "#eaf5ee", border: "#7abf9a" },
  };
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: "24px 16px", overflowY: "auto",
    }}>
      {alerts.map(({ tableId, alert }) => {
        const seats = alert.seats || [];
        const pairSeats   = seats.filter(s => s.pairing && s.pairing !== "—");
        const beetSeats   = seats.filter(s => s.beet);
        const cheeseSeats = seats.filter(s => s.cheese);
        const ts = new Date(alert.timestamp);
        const timeStr = `${String(ts.getHours()).padStart(2,"0")}:${String(ts.getMinutes()).padStart(2,"0")}`;
        return (
          <div key={tableId} style={{
            background: "#fff", borderRadius: 10, maxWidth: 480, width: "100%",
            boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              background: "#1a1a1a", padding: "14px 20px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "#fff" }}>
                  TABLE {tableId}{alert.tableName ? ` — ${alert.tableName}` : ""}
                </span>
              </div>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>{timeStr}</span>
            </div>
            {/* Body */}
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pairSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>PAIRING</span>
                  {pairSeats.map(s => {
                    const c = PAIR_COLORS[s.pairing] || {};
                    return (
                      <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: c.bg || "#f5f5f5", border: `1px solid ${c.border || "#ddd"}`, color: c.color || "#444" }}>
                        P{s.id} {s.pairing}
                      </span>
                    );
                  })}
                </div>
              )}
              {beetSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>BEETROOT</span>
                  {beetSeats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#edf8e8", border: "1px solid #88cc88", color: "#2a6a2a" }}>
                      P{s.id}{s.beet.pairing && s.beet.pairing !== "—" ? ` · ${s.beet.pairing}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {cheeseSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>CHEESE</span>
                  {cheeseSeats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#fdf4e8", border: "1px solid #c8a060", color: "#7a5020" }}>
                      P{s.id}
                    </span>
                  ))}
                </div>
              )}
              {pairSeats.length === 0 && beetSeats.length === 0 && cheeseSeats.length === 0 && (
                <span style={{ fontFamily: FONT, fontSize: 11, color: "#bbb" }}>No extras noted</span>
              )}
            </div>
            {/* Confirm */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => onConfirm(tableId)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 1.5, padding: "10px 28px",
                border: "none", borderRadius: 4, cursor: "pointer",
                background: "#1a1a1a", color: "#fff", fontWeight: 700, textTransform: "uppercase",
              }}>Confirm</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function KitchenBoard({ tables, menuCourses, upd, updMany }) {
  const activeTables = tables
    .filter(t => t.active && !t.kitchenArchived)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));
  const activeIds = activeTables.map(t => t.id).join(",");

  const [order, setOrder] = useState(() => activeTables.map(t => t.id));
  const [activeId, setActiveId] = useState(null);

  // Keep order in sync when tables are added/removed
  useEffect(() => {
    setOrder(prev => {
      const activeIdSet = new Set(activeTables.map(t => t.id));
      const kept = prev.filter(id => activeIdSet.has(id));
      const added = activeTables.map(t => t.id).filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [activeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const pendingAlerts = tables
    .filter(t => t.kitchenAlert && !t.kitchenAlert.confirmed)
    .map(t => ({ tableId: t.id, alert: t.kitchenAlert }));

  const confirmAlert = (tableId) => {
    updMany(tableId, { kitchenAlert: null });
  };

  if (activeTables.length === 0) return (
    <>
      <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
        No active tables
      </div>
      <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
    </>
  );

  const orderedTables = order.map(id => activeTables.find(t => t.id === id)).filter(Boolean);
  const activeTable  = activeId ? activeTables.find(t => t.id === activeId) : null;

  return (
    <>
    <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        if (!over || active.id === over.id) return;
        setOrder(prev => {
          const from = prev.indexOf(active.id);
          const to   = prev.indexOf(over.id);
          return arrayMove(prev, from, to);
        });
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div style={{ paddingBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12 }}>
            {orderedTables.map(t => (
              <SortableTicket
                key={t.id}
                table={t}
                menuCourses={menuCourses}
                upd={upd}
                isDragging={activeId === t.id}
                anyDragging={activeId !== null}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTable && (
          <div style={{
            width: 248, borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            opacity: 0.97,
          }}>
            <KitchenTicket table={activeTable} menuCourses={menuCourses} upd={upd} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
    </>
  );
}
