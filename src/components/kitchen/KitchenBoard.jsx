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

  const pairingColor = { Wine: tokens.text.body, "Non-Alc": tokens.text.body, Premium: tokens.text.body, "Our Story": tokens.text.body };
  const pairingBg   = { Wine: tokens.surface.card, "Non-Alc": tokens.surface.card, Premium: tokens.surface.card, "Our Story": tokens.surface.card };

  const normFlag = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const normCategory = (course) => {
    const raw = normFlag(course?.course_category);
    if (raw === "main" || raw === "optional" || raw === "celebration") return raw;
    return normFlag(course?.optional_flag) ? "optional" : "main";
  };
  const orderedOptionalSeatsByKey = (menuCourses || []).reduce((acc, course) => {
    const key = normFlag(course?.optional_flag);
    if (!key) return acc;
    // Celebration courses (e.g. Cake) auto-include all seats when table.birthday is on
    const category = normFlag(course?.course_category);
    const isCelebration = category === "celebration" || (category !== "optional" && category !== "main" && normFlag(course?.optional_flag));
    if (isCelebration && table.birthday) {
      acc[key] = [...seats];
    } else {
      acc[key] = seats.filter((s) => !!s.extras?.[key]?.ordered);
    }
    return acc;
  }, {});
  const optionalSeatsForCourse = (course) => {
    const key = normFlag(course?.optional_flag);
    if (!key) return [];
    return orderedOptionalSeatsByKey[key] || [];
  };
  const optionalKeyForCourse = (course) => normFlag(course?.optional_flag || "");
  const optionalSeatMap = orderedOptionalSeatsByKey;

  // Per-seat optional pairing state for courses with optional_pairing_flag
  const optionalPairingAlertByPairingKey = (() => {
    const result = {};
    (menuCourses || []).forEach(course => {
      const pKey = normFlag(course?.optional_pairing_flag);
      if (!pKey) return;
      const defaultOn = course.optional_pairing_default_on !== false;
      const alco = [], nonalc = [];
      seats.forEach(s => {
        const ps = s.optionalPairings?.[pKey];
        const ordered = ps?.ordered !== undefined ? !!ps.ordered : defaultOn;
        if (!ordered) return;
        const isNonAlc = ps?.mode === "nonalc" || (!ps?.mode && String(s.pairing || "").trim() === "Non-Alc");
        (isNonAlc ? nonalc : alco).push(s.id);
      });
      if (alco.length || nonalc.length) {
        const parts = [];
        if (alco.length) parts.push(`${alco.map(id => `P${id}`).join(" ")} ALCO`);
        if (nonalc.length) parts.push(`${nonalc.map(id => `P${id}`).join(" ")} N/A`);
        result[pKey] = parts.join(" · ");
      }
    });
    return result;
  })();

  const isShort = String(table.menuType || "").trim().toLowerCase() === "short";
  const isTruthyShort = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr"; };

  // Apply per-table course overrides on top of the (already globally-overridden) menuCourses
  const tableOverriddenCourses = (menuCourses || []).map(c => applyMenuOverride(c, table.courseOverrides || {}));

  // Courses to show: non-snack, optional extras only when ordered, short menu filtered
  // Celebration courses auto-show when table.birthday is on
  const courses = tableOverriddenCourses.filter(c => {
    if (c.is_snack) return false;
    const category = normCategory(c);
    if (category === "celebration" && table.birthday) return true;
    if ((category === "optional" || category === "celebration") && normFlag(c.optional_flag) && optionalSeatsForCourse(c).length === 0) return false;
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
    <div style={{ border: `2px solid ${tokens.neutral[200]}`, borderRadius: 0, overflow: "hidden", background: tokens.neutral[0], boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>

      {/* ── Header (drag handle) ── */}
      <div
        ref={dragHandleRef}
        {...dragListeners}
        role={dragListeners ? "button" : undefined}
        aria-label={dragListeners ? "Drag to reorder ticket" : undefined}
        style={{ background: tokens.neutral[0], borderBottom: `1px solid ${tokens.neutral[200]}`, padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: 8, cursor: dragListeners ? "grab" : undefined, touchAction: "none" }}
      >
        {dragListeners && (
          <span aria-hidden="true" title="Drag to reorder" style={{
            fontFamily: FONT, fontSize: 14, color: tokens.neutral[400],
            lineHeight: 1, flexShrink: 0, alignSelf: "center", letterSpacing: -2,
            userSelect: "none",
          }}>⋮⋮</span>
        )}
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? 16 : 21, fontWeight: 800, color: tokens.text.primary, lineHeight: 1, letterSpacing: -1, flexShrink: 0 }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.resName}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 0, background: tokens.neutral[100], color: tokens.neutral[500] }}>{isShort ? "SHORT" : "LONG"}</span>}
            <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 0, background: table.lang === "si" ? tokens.red.bg : tokens.green.bg, color: table.lang === "si" ? tokens.red.text : tokens.green.text, border: "1px solid", borderColor: table.lang === "si" ? tokens.red.border : tokens.green.border }}>{table.lang === "si" ? "SI" : "EN"}</span>
            {table.birthday && <span style={{ fontSize: 10 }}>🎂</span>}
            {table.guestType === "hotel" && (() => {
              const rs = Array.isArray(table.rooms) && table.rooms.length ? table.rooms.filter(Boolean) : (table.room ? [table.room] : []);
              return <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.text.muted, letterSpacing: 0.5 }}>{rs.length ? `#${rs.join(", ")}` : "Hotel"}</span>;
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.text.primary }}>{seats.length} <span style={{ fontWeight: 600, fontSize: 10, letterSpacing: 0.5 }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: tokens.text.body }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: tokens.green.border }}>arr. {table.arrivedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: allDone ? tokens.green.border : tokens.text.primary, lineHeight: 1 }}>{firedCount}<span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.border }}>{durationMins} min</div>}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setShowEdit(v => !v); setPickingRestr(null); setCustomNote(""); setEditingCourse(null); }}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "8px 7px",
              border: `1px solid ${showEdit ? tokens.charcoal.default : tokens.neutral[300]}`,
              borderRadius: 0, cursor: "pointer",
              background: showEdit ? tokens.tint.parchment : tokens.neutral[0],
              color: showEdit ? tokens.text.secondary : tokens.text.muted,
              touchAction: "manipulation",
            }}>✏ EDIT</button>
        </div>
      </div>

      {/* ── Notes banner ── */}
      {table.notes && (
        <div style={{ background: tokens.tint.parchment, borderBottom: `1px solid ${tokens.neutral[300]}`, padding: "5px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1.4 }}>📋</span>
          <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, lineHeight: 1.35, fontStyle: "italic" }}>{table.notes}</span>
        </div>
      )}

      {/* ── Temp restriction editor ── */}
      {showEdit && (
        <div style={{ borderBottom: `1px solid ${tokens.neutral[200]}`, padding: "8px 10px", background: tokens.neutral[50] }}>
          {/* Existing kitchen-added restrictions */}
          {restrictions.map((r, i) => r.kitchenAdded ? (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text, fontWeight: 600 }}>
                {restrLabel(r.note)}{r.pos ? ` → P${r.pos}` : " → All"}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeKitchenRestr(i); }}
                aria-label={`Remove restriction ${restrLabel(r.note)}`}
                style={{ fontFamily: FONT, fontSize: 10, padding: 0, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation", flexShrink: 0 }}>✕</button>
            </div>
          ) : null)}
          {/* Step 1: pick restriction */}
          {!pickingRestr && (
            <>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: tokens.text.muted, textTransform: "uppercase", marginBottom: 6 }}>Add restriction</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RESTRICTIONS.map(r => (
                  <button key={r.key}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setPickingRestr(r.key); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.body, touchAction: "manipulation" }}>
                    {r.emoji} {r.label}
                  </button>
                ))}
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setPickingRestr("custom"); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.muted, touchAction: "manipulation" }}>
                  + Custom
                </button>
              </div>
            </>
          )}
          {/* Step 2a: assign to seat */}
          {pickingRestr && pickingRestr !== "custom" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.body, marginBottom: 6 }}>
                {restrLabel(pickingRestr)} → assign to:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "9px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary, fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "9px 10px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.disabled, touchAction: "manipulation" }}>cancel</button>
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
                style={{ fontFamily: FONT, fontSize: 10, padding: "5px 8px", border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, width: "100%", marginBottom: 6, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "9px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary, fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "9px 10px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); setCustomNote(""); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.disabled, touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pace ── */}
      <div style={{ borderBottom: `1px solid ${tokens.neutral[200]}`, padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.text.muted, textTransform: "uppercase", flexShrink: 0 }}>Pace</span>
        {["Slow", "Fast"].map(p => {
          const colors = { Slow: { on: tokens.text.primary, bg: tokens.surface.card, border: tokens.charcoal.default }, Fast: { on: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border } };
          const active = table.pace === p;
          const col = colors[p];
          return (
            <button key={p} onClick={() => upd && upd(table.id, "pace", active ? "" : p)} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "9px 10px",
              border: `1px solid ${active ? col.border : tokens.neutral[200]}`,
              borderRadius: 0, cursor: upd ? "pointer" : "default",
              background: active ? col.bg : tokens.neutral[0], color: active ? col.on : tokens.text.disabled,
              transition: "all 0.1s",
            }}>{p}</button>
          );
        })}
      </div>

      {/* ── Seats ── */}
      <div style={{ background: tokens.neutral[50], borderBottom: `1px solid ${tokens.neutral[200]}`, padding: "5px 10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
          {seats.map(s => {
            const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
            const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
            const restrShort = k => { const d = RESTRICTIONS.find(r => r.key === k); return d ? d.label : k; };
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 0,
                  background: p ? (pairingBg[p] || tokens.neutral[200]) : tokens.neutral[200],
                  color: p ? (pairingColor[p] || tokens.text.body) : tokens.text.body,
                }}>P{s.id}{p ? ` · ${pLabel(p)}` : ""}</span>
                {restrList.length > 0 && (
                  <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.red.text, letterSpacing: 0.2, fontWeight: 600 }}>{restrList.map(restrShort).join(" · ")}</span>
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
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${tokens.neutral[200]}` }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.red.text, textTransform: "uppercase", flexShrink: 0 }}>⚠ Unassigned</span>
                {unassigned.map(r => (
                  <span
                    key={r._i}
                    onClick={() => setAssigningRestrIdx(assigningRestrIdx === r._i ? null : r._i)}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "9px 8px", borderRadius: 0,
                      border: `1px solid ${tokens.red.border}`,
                      background: assigningRestrIdx === r._i ? tokens.red.text : tokens.red.bg,
                      color: assigningRestrIdx === r._i ? tokens.text.primary : tokens.red.text,
                      fontWeight: 500, cursor: "pointer", userSelect: "none", touchAction: "manipulation",
                    }}
                  >{restrLabel(r.note)} {assigningRestrIdx === r._i ? "→ pick seat" : "→"}</span>
                ))}
              </div>
              {assigningRestrIdx !== null && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, flexShrink: 0 }}>Assign to:</span>
                  {seats.map(s => (
                    <button key={s.id} onClick={() => assignRestrToSeat(s.id)} style={{
                      fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "9px 10px",
                      border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation",
                    }}>P{s.id}</button>
                  ))}
                  <button onClick={() => setAssigningRestrIdx(null)} style={{
                    fontFamily: FONT, fontSize: 9, padding: "9px 8px",
                    border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0], color: tokens.text.disabled, touchAction: "manipulation",
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
                // Notes are stored at the sibling key `${k}_note` (per the DB serializer).
                // Fall back to the legacy nested form for any in-flight local state.
                const n = course.restrictions?.[`${k}_note`] || course.restrictions?.[k]?.kitchen_note;
                if (typeof n === "string" && n.trim()) notes.add(n.trim());
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
            const orderedSeats = optionalSeatMap[optKey] || [];
            if (orderedSeats.length === 0) return null;
            const marks = table.birthday && normCategory(course) === "celebration"
              ? "ALL"
              : orderedSeats.map(s => `P${s.id}`).join(" ");
            return marks + ((optKey === "cake" && table.cakeNote) ? ` — ${table.cakeNote}` : "");
          })();

          // Optional drink pairing alert — only shown for the Crayfish course;
          // all other courses with optional_pairing_flag are not surfaced on the ticket.
          const pairingAlert = (() => {
            const pKey = normFlag(course?.optional_pairing_flag);
            if (!pKey) return null;
            if (normFlag(course?.course_key) !== "crayfish") return null;
            return optionalPairingAlertByPairingKey[pKey] || null;
          })();

          const kcNote = kitchenCourseNotes[key] || {};
          const displayName = kcNote.name || line1;
          const isEditingThis = editingCourse === key;

          return (
            <div key={key} style={{
              borderBottom: `1px solid ${tokens.neutral[200]}`,
              background: fired ? tokens.green.bg : tokens.neutral[0],
              borderLeft: fired ? `4px solid ${tokens.green.border}` : kcNote.name || kcNote.note ? `4px solid ${tokens.red.text}` : "4px solid transparent",
            }}>
              <div
                onClick={() => !isEditingThis && (fired ? unfire(key) : fire(key))}
                style={{ display: "flex", alignItems: "center", padding: "7px 10px 7px 8px", gap: 7, cursor: isEditingThis ? "default" : "pointer" }}>
                <span style={{ fontFamily: FONT, fontSize: 13, color: fired ? tokens.green.border : tokens.neutral[300], flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                    color: fired ? tokens.text.disabled : kcNote.name ? tokens.red.text : tokens.text.primary,
                    textDecoration: fired ? "line-through" : "none",
                    letterSpacing: 0.2,
                  }}>
                    {displayName}
                    {kcNote.name && <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 400, color: tokens.text.muted, marginLeft: 5 }}>({line1})</span>}
                    {extraLabel && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 400, color: tokens.text.disabled, marginLeft: 6 }}>{extraLabel}</span>}
                  </div>
                  {(pairingAlert || modGroups || kitchenNote || kcNote.note) && !fired && (
                    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {pairingAlert && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>{pairingAlert}</span>}
                      {modGroups && Object.entries(modGroups).sort(([a], [b]) => (a === baseName ? -1 : 1) - (b === baseName ? -1 : 1)).map(([name, count]) => (
                        <span key={name} style={{ fontFamily: FONT, fontSize: 10, color: name === baseName ? tokens.text.body : tokens.red.text, fontWeight: 600 }}>{count}× {name}</span>
                      ))}
                      {kitchenNote && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text, fontWeight: 600 }}>{kitchenNote}</span>}
                      {kcNote.note && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text, fontWeight: 600 }}>⚑ {kcNote.note}</span>}
                    </div>
                  )}
                </div>
                {showEdit && !fired && (
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); if (isEditingThis) { saveCourseDraft(key, editName, editNote); setEditingCourse(null); } else { startEditCourse(key); } }}
                    aria-label={isEditingThis ? `Save changes to ${displayName}` : `Edit ${displayName}`}
                    title={isEditingThis ? "Save course override" : "Edit course override"}
                    style={{
                      fontFamily: FONT, fontSize: 11, padding: 0, flexShrink: 0,
                      width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      border: `1px solid ${isEditingThis ? tokens.charcoal.default : tokens.neutral[300]}`,
                      borderRadius: 0, cursor: "pointer",
                      background: isEditingThis ? tokens.tint.parchment : tokens.neutral[0],
                      color: isEditingThis ? tokens.text.secondary : tokens.text.muted,
                      touchAction: "manipulation",
                    }}>✏</button>
                )}
                {firedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.border, fontWeight: 700, flexShrink: 0 }}>{firedAt}</span>}
              </div>
              {/* Inline course editor */}
              {isEditingThis && (
                <div onPointerDown={e => e.stopPropagation()} style={{ padding: "0 10px 8px 28px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder={`Rename "${line1}"…`}
                    style={{ fontFamily: FONT, fontSize: 10, padding: "9px 7px", border: `1px solid ${tokens.red.text}`, borderRadius: 0, width: "100%", boxSizing: "border-box" }}
                  />
                  <input
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder="Add note (e.g. No Ricotta)…"
                    style={{ fontFamily: FONT, fontSize: 10, padding: "9px 7px", border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, width: "100%", boxSizing: "border-box" }}
                  />
                  {(kcNote.name || kcNote.note) && (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); clearCourseNote(key); }}
                      style={{ fontFamily: FONT, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, alignSelf: "flex-start", touchAction: "manipulation" }}>Clear override</button>
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
          <div style={{ background: tokens.green.bg, borderTop: `2px solid ${tokens.green.border}`, padding: "7px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 13, color: tokens.green.border }}>✓</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {durLabel && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.border, fontWeight: 700, letterSpacing: 0.5 }}>{durLabel}</span>}
                {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: 0.3 }}>{timeRange}</span>}
                {!durLabel && !timeRange && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.border, fontWeight: 700, letterSpacing: 1 }}>COMPLETE</span>}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); upd && upd(table.id, "kitchenArchived", true); }}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "9px 10px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.green.border, textTransform: "uppercase", touchAction: "manipulation",
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
          border: `2px dashed ${tokens.green.border}`, borderRadius: 0,
          background: tokens.green.bg,
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
    Wine:      { color: tokens.text.body, bg: tokens.surface.card, border: tokens.neutral[300] },
    "Non-Alc": { color: tokens.text.body, bg: tokens.surface.card, border: tokens.neutral[300] },
    Premium:   { color: tokens.text.body, bg: tokens.surface.card, border: tokens.neutral[300] },
    "Our Story":{ color: tokens.text.body, bg: tokens.surface.card, border: tokens.neutral[300] },
  };
  return (
    <div role="dialog" aria-label="Kitchen pairing alerts" style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: "24px 16px", overflowY: "auto",
      paddingTop: "calc(24px + env(safe-area-inset-top))",
      paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
    }}>
      {alerts.map(({ tableId, alert }) => {
        const seats = alert.seats || [];
        const pairSeats = seats.filter(s => s.pairing && s.pairing !== "—");
        // Build extras groups — support both new array format and legacy {beet, cheese} format
        const extrasMap = {};
        seats.forEach(s => {
          if (Array.isArray(s.extras)) {
            s.extras.forEach(ex => {
              if (!extrasMap[ex.key]) extrasMap[ex.key] = { name: ex.name, seats: [] };
              extrasMap[ex.key].seats.push({ id: s.id, pairing: ex.pairing });
            });
          } else {
            // legacy format
            if (s.beet) {
              if (!extrasMap.beetroot) extrasMap.beetroot = { name: "Beetroot", seats: [] };
              extrasMap.beetroot.seats.push({ id: s.id, pairing: s.beet.pairing });
            }
            if (s.cheese) {
              if (!extrasMap.cheese) extrasMap.cheese = { name: "Cheese", seats: [] };
              extrasMap.cheese.seats.push({ id: s.id, pairing: "—" });
            }
          }
        });
        const extrasGroups = Object.values(extrasMap);
        const ts = new Date(alert.timestamp);
        const timeStr = `${String(ts.getHours()).padStart(2,"0")}:${String(ts.getMinutes()).padStart(2,"0")}`;
        return (
          <div key={tableId} style={{
            background: tokens.neutral[0], borderRadius: 0, maxWidth: 480, width: "100%",
            boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              background: tokens.neutral[0], padding: "14px 20px",
              borderBottom: `1px solid ${tokens.neutral[200]}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: 2, color: tokens.text.primary }}>
                  TABLE {tableId}{alert.tableName ? ` — ${alert.tableName}` : ""}
                </span>
              </div>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, letterSpacing: 1 }}>{timeStr}</span>
            </div>
            {/* Body */}
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pairSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: tokens.text.muted, minWidth: 60 }}>PAIRING</span>
                  {pairSeats.map(s => {
                    const c = PAIR_COLORS[s.pairing] || {};
                    return (
                      <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 0, background: c.bg || tokens.neutral[50], border: `1px solid ${c.border || tokens.neutral[300]}`, color: c.color || tokens.text.body }}>
                        P{s.id} {s.pairing}
                      </span>
                    );
                  })}
                </div>
              )}
              {extrasGroups.map(group => (
                <div key={group.name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: tokens.text.muted, minWidth: 60 }}>{group.name.toUpperCase()}</span>
                  {group.seats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 0, background: tokens.green.bg, border: `1px solid ${tokens.green.border}`, color: tokens.green.text }}>
                      P{s.id}{s.pairing && s.pairing !== "—" ? ` · ${s.pairing}` : ""}
                    </span>
                  ))}
                </div>
              ))}
              {pairSeats.length === 0 && extrasGroups.length === 0 && (
                <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.text.disabled }}>No extras noted</span>
              )}
            </div>
            {/* Confirm */}
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${tokens.neutral[200]}`, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => onConfirm(tableId)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 1.5, padding: "10px 28px",
                border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
                background: tokens.surface.card, color: tokens.text.primary, fontWeight: 700, textTransform: "uppercase",
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
      <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.text.disabled, textAlign: "center", paddingTop: 80 }}>
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
            width: 248, borderRadius: 0,
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
