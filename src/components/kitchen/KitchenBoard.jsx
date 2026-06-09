import { useEffect, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, MeasuringStrategy, rectIntersection, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { RESTRICTIONS, restrLabel } from "../../constants/dietary.js";
import { getCourseMod, optionalPairingsFromCourses, resolveSeatRestrictionKeys } from "../../utils/menuUtils.js";
import { fmt, parseHHMM } from "../../utils/tableHelpers.js";
import { tokens } from "../../styles/tokens.js";
import { getVisibleCoursesForTable } from "../../utils/courseProgress.js";
import { extraPairingLabel, extraPairingForSeat } from "../../constants/pairings.js";
import { useKitchenColumns, AUTO, COLS_MIN, COLS_MAX } from "../../hooks/useKitchenColumns.js";

const FONT = tokens.font;

// Responsive grid sizing. In "auto" mode the board fits as many columns as the
// screen comfortably allows at this minimum ticket width; an explicit column
// count overrides it. GAP/PAD are used to estimate the current auto column count
// (for the +/− control) from the viewport without measuring the DOM.
const TICKET_MIN_W = 240;
const TICKET_GAP = 12;
const BOARD_HPAD = 48; // 24px container padding each side (see Kitchen mode wrapper)

export function estimateAutoCols(viewportWidth) {
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  return Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round((vw - BOARD_HPAD + TICKET_GAP) / (TICKET_MIN_W + TICKET_GAP))));
}

// Resolve course list template from the guest menu profile — same logic as the
// print generator — so both live board and ticket preview show the same courses.
function resolveGuestTemplate(table, profiles, assignments) {
  const guestId = assignments?.longMenuProfileId;
  if (!guestId || !Array.isArray(profiles)) return null;
  const p = profiles.find(pr => pr.id === guestId);
  if (!p) return null;
  const isShort = String(table?.menuType || "").toLowerCase() === "short";
  return isShort ? (p.shortMenuTemplate || p.menuTemplate) : p.menuTemplate;
}

export function KitchenTicket({ table, menuCourses, upd, dragHandleRef, dragListeners, profiles = [], assignments = {}, kitchenTemplate = null, editable = false, quickNotes = {} }) {
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const log = table.kitchenLog || {};
  const [assigningRestrIdx, setAssigningRestrIdx] = useState(null);
  const kitchenCourseNotes = table.kitchenCourseNotes || {};
  // Edit mode (only when `editable` prop set — i.e. ticket preview in reservations).
  // Per-course edits stage into draftNotes and commit explicitly via the Save button,
  // so the user can review changes before persisting them to the reservation row.
  const [showEdit, setShowEdit] = useState(false);
  const [pickingRestr, setPickingRestr] = useState(null);
  const [customNote, setCustomNote] = useState("");
  const [draftNotes, setDraftNotes] = useState(kitchenCourseNotes);

  useEffect(() => {
    if (!showEdit) setDraftNotes(kitchenCourseNotes);
  }, [showEdit, kitchenCourseNotes]);

  const addKitchenRestr = (note, seatId) => {
    if (!note?.trim()) return;
    const next = [...restrictions, { note: note.trim(), pos: (seatId ?? null), kitchenAdded: true }];
    upd(table.id, "restrictions", next);
    setPickingRestr(null);
    setCustomNote("");
  };
  const removeKitchenRestr = (origIdx) => {
    const next = restrictions.filter((_, i) => i !== origIdx);
    upd(table.id, "restrictions", next);
  };
  const updateDraftEntry = (key, patch) => {
    setDraftNotes((prev) => {
      const current = prev[key] || {};
      const next = { ...current, ...patch };
      if (!next.name) delete next.name;
      if (!next.note) delete next.note;
      if (next.presets && Object.keys(next.presets).length === 0) delete next.presets;
      const out = { ...prev };
      if (!next.name && !next.note && !next.presets) delete out[key];
      else out[key] = next;
      return out;
    });
  };
  const bumpDraftPreset = (key, text) => {
    const current = draftNotes[key]?.presets || {};
    updateDraftEntry(key, { presets: { ...current, [text]: (current[text] || 0) + 1 } });
  };
  const clearDraftPreset = (key, text) => {
    const current = { ...(draftNotes[key]?.presets || {}) };
    delete current[text];
    updateDraftEntry(key, { presets: current });
  };
  const clearDraftEntry = (key) => {
    setDraftNotes((prev) => {
      const out = { ...prev };
      delete out[key];
      return out;
    });
  };
  const saveDraftNotes = () => {
    upd(table.id, "kitchenCourseNotes", draftNotes);
    setShowEdit(false);
  };
  const cancelDraftNotes = () => {
    setDraftNotes(kitchenCourseNotes);
    setShowEdit(false);
    setPickingRestr(null);
    setCustomNote("");
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

  // Unassigned restrictions (pos: null) apply to every seat so their course mods
  // surface on the kitchen board until staff pick a position from the UNASSIGNED bar.
  const seatRestrKeys = (seat) => resolveSeatRestrictionKeys(restrictions, seat.id);

  const pairingColor = { Wine: tokens.ink[2], "Non-Alc": tokens.ink[2], Premium: tokens.ink[2], "Our Story": tokens.ink[2] };
  const pairingBg   = { Wine: tokens.neutral[0], "Non-Alc": tokens.neutral[0], Premium: tokens.neutral[0], "Our Story": tokens.neutral[0] };
  const optionalPairings = optionalPairingsFromCourses(menuCourses || []);

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

  // Courses to show — delegated to shared helper. When a kitchen profile is
  // assigned for this table.menuType, the profile's row-based menuTemplate
  // drives course visibility/order via deriveCourseKeysFromTemplate; otherwise
  // we fall back to the legacy show_on_short / position rules so older
  // sessions stay stable.
  const visibleCoursesForTable = getVisibleCoursesForTable(
    table,
    menuCourses || [],
    kitchenTemplate
      ? { kitchenTemplate }
      : { kitchenTemplate: resolveGuestTemplate(table, profiles, assignments) }
  );
  const kitchenItemByCourseKey = visibleCoursesForTable.reduce((acc, vc) => {
    if (vc.kitchenItem) acc[vc.key] = vc.kitchenItem;
    return acc;
  }, {});
  const courses = visibleCoursesForTable.map(c => c.rawCourse);

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
    <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, overflow: "hidden", background: tokens.neutral[0] }}>

      {/* ── Header (drag handle) ── */}
      <div
        ref={dragHandleRef}
        {...dragListeners}
        role={dragListeners ? "button" : undefined}
        aria-label={dragListeners ? "Drag to reorder ticket" : undefined}
        style={{ background: tokens.neutral[0], borderBottom: `1px solid ${tokens.ink[4]}`, padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: 8, cursor: dragListeners ? "grab" : undefined, touchAction: "none" }}
      >
        {dragListeners && (
          <span aria-hidden="true" title="Drag to reorder" style={{
            fontFamily: FONT, fontSize: 14, color: tokens.ink[4],
            lineHeight: 1, flexShrink: 0, alignSelf: "center", letterSpacing: -2,
            userSelect: "none",
          }}>⋮⋮</span>
        )}
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? "15px" : "20px", fontWeight: 800, color: tokens.ink[0], lineHeight: 1, letterSpacing: "-0.02em", flexShrink: 0 }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: "11px", fontWeight: 700, color: tokens.ink[0], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.resName}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 0, background: tokens.ink[5], color: tokens.ink[3] }}>{isShort ? "SHORT" : "LONG"}</span>}
            <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 0, background: table.lang === "si" ? tokens.red.bg : tokens.green.bg, color: table.lang === "si" ? tokens.red.text : tokens.green.text, border: "1px solid", borderColor: table.lang === "si" ? tokens.red.border : tokens.green.border }}>{table.lang === "si" ? "SI" : "EN"}</span>
            {table.birthday && <span style={{ fontSize: "10px" }}>🎂</span>}
            {table.guestType === "hotel" && (() => {
              const rs = Array.isArray(table.rooms) && table.rooms.length ? table.rooms.filter(Boolean) : (table.room ? [table.room] : []);
              return <span style={{ fontFamily: FONT, fontSize: "8px", color: tokens.ink[3], letterSpacing: "0.06em" }}>{rs.length ? `#${rs.join(", ")}` : "Hotel"}</span>;
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 700, color: tokens.ink[0] }}>{seats.length} <span style={{ fontWeight: 400, fontSize: "9px", letterSpacing: "0.06em" }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 600, color: tokens.ink[2] }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 600, color: tokens.green.border }}>arr. {table.arrivedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 700, color: allDone ? tokens.green.border : tokens.ink[0], lineHeight: 1 }}>{firedCount}<span style={{ fontSize: "9px", color: tokens.ink[3], fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: "8px", color: tokens.green.border }}>{durationMins} min</div>}
          {editable && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); if (showEdit) cancelDraftNotes(); else setShowEdit(true); }}
              style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "8px 7px",
                border: `1px solid ${showEdit ? tokens.charcoal.default : tokens.ink[4]}`,
                borderRadius: 0, cursor: "pointer",
                background: showEdit ? tokens.tint.parchment : tokens.neutral[0],
                color: showEdit ? tokens.ink[0] : tokens.ink[3],
                touchAction: "manipulation",
              }}>{showEdit ? "✕ CANCEL" : "✏ EDIT"}</button>
          )}
        </div>
      </div>

      {/* ── Notes banner ── */}
      {table.notes && (
        <div style={{ background: tokens.tint.parchment, borderBottom: `1px solid ${tokens.ink[4]}`, padding: "5px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], flexShrink: 0, lineHeight: 1.4 }}>📋</span>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[2], lineHeight: 1.35, fontStyle: "italic" }}>{table.notes}</span>
        </div>
      )}

      {/* ── Ad-hoc restriction editor (ticket-preview only) ── */}
      {editable && showEdit && (
        <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, padding: "8px 10px", background: tokens.neutral[0] }}>
          {restrictions.map((r, i) => r.kitchenAdded ? (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.red.text, fontWeight: 600 }}>
                {restrLabel(r.note)}{r.pos ? ` → P${r.pos}` : " → All"}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeKitchenRestr(i); }}
                aria-label={`Remove restriction ${restrLabel(r.note)}`}
                style={{ fontFamily: FONT, fontSize: "10px", padding: 0, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation", flexShrink: 0 }}>✕</button>
            </div>
          ) : null)}
          {!pickingRestr && (
            <>
              <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>ADD RESTRICTION</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RESTRICTIONS.map(r => (
                  <button key={r.key}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setPickingRestr(r.key); }}
                    style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2], touchAction: "manipulation" }}>
                    {r.emoji} {r.label}
                  </button>
                ))}
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setPickingRestr("custom"); }}
                  style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation" }}>
                  + Custom
                </button>
              </div>
            </>
          )}
          {pickingRestr && pickingRestr !== "custom" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[2], marginBottom: 6 }}>
                {restrLabel(pickingRestr)} → assign to:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, null); }}
                  style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, s.id); }}
                    style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 10px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); }}
                  style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
          {pickingRestr === "custom" && (
            <div>
              <input
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="e.g. No Ricotta"
                onPointerDown={e => e.stopPropagation()}
                style={{ fontFamily: FONT, fontSize: "10px", padding: "5px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, width: "100%", marginBottom: 6, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, null); }}
                  style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, s.id); }}
                    style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 10px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); setCustomNote(""); }}
                  style={{ fontFamily: FONT, fontSize: "9px", padding: "8px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pace ── */}
      <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase", flexShrink: 0 }}>PACE</span>
        {["Slow", "Fast"].map(p => {
          const colors = { Slow: { on: tokens.ink[0], bg: tokens.neutral[0], border: tokens.charcoal.default }, Fast: { on: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border } };
          const active = table.pace === p;
          const col = colors[p];
          return (
            <button key={p} onClick={() => upd && upd(table.id, "pace", active ? "" : p)} style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "9px 10px",
              border: `1px solid ${active ? col.border : tokens.ink[4]}`,
              borderRadius: 0, cursor: upd ? "pointer" : "default",
              background: active ? col.bg : tokens.neutral[0], color: active ? col.on : tokens.ink[3],
              transition: "all 0.1s",
            }}>{p}</button>
          );
        })}
      </div>

      {/* ── Seats ── */}
      <div style={{ background: tokens.neutral[0], borderBottom: `1px solid ${tokens.ink[4]}`, padding: "5px 10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
        {seats.map(s => {
            const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
            const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
            const restrShort = k => { const d = RESTRICTIONS.find(r => r.key === k); return d ? d.label : k; };
            const gs = s.gender === "Mr" ? tokens.gender.male : s.gender === "Mrs" ? tokens.gender.female : null;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{
                  fontFamily: FONT, fontSize: "8px", fontWeight: 700, padding: "2px 5px", borderRadius: 0,
                  background: p ? (pairingBg[p] || tokens.ink[5]) : tokens.ink[5],
                  color: p ? (pairingColor[p] || tokens.ink[2]) : tokens.ink[2],
                  border: `1px solid ${tokens.ink[4]}`,
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  P{s.id}
                  {gs && <span style={{ fontSize: "7px", fontWeight: 700, padding: "0 3px", background: gs.bg, color: gs.text, letterSpacing: 0 }}>{s.gender}</span>}
                  {p ? ` · ${pLabel(p)}` : ""}
                </span>
                {restrList.length > 0 && (
                  <span style={{ fontFamily: FONT, fontSize: "8px", color: tokens.red.text, letterSpacing: "0.06em", fontWeight: 600 }}>{restrList.map(restrShort).join(" · ")}</span>
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
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${tokens.ink[4]}` }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.red.text, textTransform: "uppercase", flexShrink: 0 }}>⚠ UNASSIGNED</span>
                {unassigned.map(r => (
                  <span
                    key={r._i}
                    onClick={() => setAssigningRestrIdx(assigningRestrIdx === r._i ? null : r._i)}
                    style={{
                      fontFamily: FONT, fontSize: "8px", padding: "9px 8px", borderRadius: 0,
                      border: `1px solid ${tokens.red.border}`,
                      background: assigningRestrIdx === r._i ? tokens.red.text : tokens.red.bg,
                      color: assigningRestrIdx === r._i ? tokens.neutral[0] : tokens.red.text,
                      fontWeight: 500, cursor: "pointer", userSelect: "none", touchAction: "manipulation",
                    }}
                  >{restrLabel(r.note)} {assigningRestrIdx === r._i ? "→ pick seat" : "→"}</span>
                ))}
              </div>
              {assigningRestrIdx !== null && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                  <span style={{ fontFamily: FONT, fontSize: "8px", color: tokens.red.text, flexShrink: 0 }}>ASSIGN TO:</span>
                  {seats.map(s => (
                    <button key={s.id} onClick={() => assignRestrToSeat(s.id)} style={{
                      fontFamily: FONT, fontSize: "9px", fontWeight: 700, padding: "9px 10px",
                      border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation",
                    }}>P{s.id}</button>
                  ))}
                  <button onClick={() => setAssigningRestrIdx(null)} style={{
                    fontFamily: FONT, fontSize: "9px", padding: "9px 8px",
                    border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation",
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

          // Kitchen layout item (when this table's assigned kitchen layout
          // contains this course). It can override the display name and turn
          // off restriction/pairing/seat/course-note overlays per course.
          const kitchenItem = kitchenItemByCourseKey[key] || null;
          const layoutName = kitchenItem?.kitchenDisplayName?.trim?.() || "";
          const showRestrictions = kitchenItem ? kitchenItem.showRestrictions !== false : true;
          const showSeatNotes    = kitchenItem ? kitchenItem.showSeatNotes    !== false : true;
          const showCourseNotes  = kitchenItem ? kitchenItem.showCourseNotes  !== false : true;
          const showPairingAlert = kitchenItem ? kitchenItem.showPairingAlert !== false : true;

          const baseName = layoutName || course.menu?.name || key;
          const kcNotePreview = kitchenCourseNotes[key] || {};
          const mods = (() => {
            const counts = {};
            if (showRestrictions && !fired) {
              seats.forEach(seat => {
                const restrKeys = seatRestrKeys(seat);
                if (!restrKeys.length) return;
                const mod = getCourseMod(course, restrKeys);
                if (mod) counts[mod] = (counts[mod] || 0) + 1;
              });
            }
            // Per-course quick-note presets are applied in reservations mode
            // and stored as { [label]: count }. Merge them in so they render
            // alongside restriction-derived mods using the same Nx format.
            if (!fired && kcNotePreview.presets && typeof kcNotePreview.presets === "object") {
              Object.entries(kcNotePreview.presets).forEach(([label, n]) => {
                const inc = Number(n) || 0;
                if (inc <= 0) return;
                counts[label] = (counts[label] || 0) + inc;
              });
            }
            return Object.keys(counts).length > 0 ? counts : null;
          })();
          const extraLabel = (() => {
            if (!showSeatNotes) return null;
            const optKey = optionalKeyForCourse(course);
            if (!optKey) return null;
            const orderedSeats = optionalSeatMap[optKey] || [];
            if (orderedSeats.length === 0) return null;
            const isBirthdayCake = table.birthday && normCategory(course) === "celebration";
            const dish = { key: optKey, id: optKey };
            const anyShared = !isBirthdayCake && orderedSeats.some(s => (s.extras?.[optKey]?.sharedWith ?? null) !== null);
            const marks = isBirthdayCake
              ? "ALL"
              : orderedSeats.map(s => {
                  const p = extraPairingForSeat(s, dish, optionalPairings);
                  return `P${s.id}${p ? `·${p}` : ""}`;
                }).join(" ");
            return marks + (anyShared ? " Share" : "") + ((optKey === "cake" && table.cakeNote) ? ` — ${table.cakeNote}` : "");
          })();

          // Optional drink pairing alert — only shown for the Crayfish course;
          // all other courses with optional_pairing_flag are not surfaced on the ticket.
          const pairingAlert = (() => {
            if (!showPairingAlert) return null;
            const pKey = normFlag(course?.optional_pairing_flag);
            if (!pKey) return null;
            if (normFlag(course?.course_key) !== "crayfish") return null;
            return optionalPairingAlertByPairingKey[pKey] || null;
          })();

          const kcNote = kcNotePreview;
          const displayName = kcNote.name || baseName;
          const draftEntry = draftNotes[key] || {};
          const draftPresets = draftEntry.presets || {};
          const chips = (editable && showEdit) ? (quickNotes[key] || []) : [];
          const draftHasAny = draftEntry.name || draftEntry.note || Object.keys(draftPresets).length > 0;

          return (
            <div key={key} style={{
              borderBottom: `1px solid ${tokens.ink[4]}`,
              background: fired ? tokens.green.bg : tokens.neutral[0],
              borderLeft: fired ? `4px solid ${tokens.green.border}` : kcNote.name || kcNote.note ? `4px solid ${tokens.red.text}` : "4px solid transparent",
            }}>
              <div
                onClick={() => { if (editable && showEdit) return; fired ? unfire(key) : fire(key); }}
                style={{ display: "flex", alignItems: "center", padding: "7px 10px 7px 8px", gap: 7, cursor: editable && showEdit ? "default" : "pointer" }}>
                <span style={{ fontFamily: FONT, fontSize: "12px", color: fired ? tokens.green.border : tokens.ink[4], flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT, fontSize: "11px", fontWeight: 700, lineHeight: 1.25,
                    color: fired ? tokens.ink[4] : kcNote.name ? tokens.red.text : tokens.ink[0],
                    textDecoration: fired ? "line-through" : "none",
                    letterSpacing: "0.02em",
                  }}>
                    {displayName}
                    {kcNote.name && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 400, color: tokens.ink[3], marginLeft: 5 }}>({baseName})</span>}
                    {extraLabel && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 400, color: tokens.ink[4], marginLeft: 6 }}>{extraLabel}</span>}
                  </div>
                  {(pairingAlert || mods || (kcNote.note && showCourseNotes)) && !fired && (
                    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {pairingAlert && <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], fontWeight: 600 }}>{pairingAlert}</span>}
                      {mods && Object.entries(mods).map(([mod, count]) => (
                        <span key={mod} style={{ fontFamily: FONT, fontSize: "9px", color: tokens.red.text, fontWeight: 600 }}>{count}× {mod}</span>
                      ))}
                      {kcNote.note && showCourseNotes && <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.red.text, fontWeight: 600 }}>⚑ {kcNote.note}</span>}
                    </div>
                  )}
                </div>
                {firedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.border, fontWeight: 700, flexShrink: 0 }}>{firedAt}</span>}
              </div>
              {editable && showEdit && (
                <div onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} style={{ padding: "0 10px 8px 28px", display: "flex", flexDirection: "column", gap: 5, background: draftHasAny ? tokens.red.bg : "transparent" }}>
                  <input
                    value={draftEntry.name || ""}
                    onChange={e => updateDraftEntry(key, { name: e.target.value })}
                    placeholder={`Rename "${baseName}"…`}
                    style={{ fontFamily: FONT, fontSize: "10px", padding: "8px 7px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, width: "100%", boxSizing: "border-box" }}
                  />
                  <input
                    value={draftEntry.note || ""}
                    onChange={e => updateDraftEntry(key, { note: e.target.value })}
                    placeholder="Note (e.g. No Ricotta)…"
                    style={{ fontFamily: FONT, fontSize: "10px", padding: "8px 7px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, width: "100%", boxSizing: "border-box" }}
                  />
                  {chips.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {chips.map(chip => {
                        const count = draftPresets[chip] || 0;
                        const active = count > 0;
                        return (
                          <button key={chip}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); bumpDraftPreset(key, chip); }}
                            onContextMenu={e => { e.preventDefault(); if (active) clearDraftPreset(key, chip); }}
                            title={active ? "Click to add another, right-click × to clear" : "Click to apply"}
                            style={{
                              fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "6px 9px",
                              border: `1px solid ${active ? tokens.red.border : tokens.ink[4]}`,
                              borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                              background: active ? tokens.red.bg : tokens.neutral[0],
                              color: active ? tokens.red.text : tokens.ink[2],
                              fontWeight: active ? 600 : 400,
                            }}>
                            {active && <span style={{ marginRight: 4, fontWeight: 700 }}>{count}×</span>}
                            {chip}
                            {active && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={e => { e.stopPropagation(); clearDraftPreset(key, chip); }}
                                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); clearDraftPreset(key, chip); } }}
                                aria-label={`Clear ${chip}`}
                                style={{ marginLeft: 4, color: tokens.red.border, cursor: "pointer", fontSize: 12, lineHeight: 1, display: "inline-block" }}
                              >×</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {draftHasAny && (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); clearDraftEntry(key); }}
                      style={{ fontFamily: FONT, fontSize: 9, padding: "6px 8px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text, alignSelf: "flex-start", touchAction: "manipulation" }}>Clear this course</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Save / cancel bar (ticket-preview only) ── */}
      {editable && showEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: "10px 10px 12px", borderTop: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0] }}>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); cancelDraftNotes(); }}
            style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation" }}>CANCEL</button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); saveDraftNotes(); }}
            style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 20px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 600, touchAction: "manipulation" }}>SAVE</button>
        </div>
      )}

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

export function SortableTicket({ table, menuCourses, upd, isDragging, anyDragging, profiles = [], assignments = {} }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{
        // Fill the grid cell so the ticket width tracks the chosen column count
        // (real pixels — crisp at native resolution, no zoom).
        width: "100%", minWidth: 0,
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
          width: "100%", height: "100%", minHeight: 120,
          border: `2px dashed ${tokens.green.border}`, borderRadius: 0,
          background: tokens.green.bg,
        }} />
      ) : (
        <KitchenTicket
          table={table}
          menuCourses={menuCourses}
          upd={upd}
          dragHandleRef={setActivatorNodeRef}
          dragListeners={listeners}
          profiles={profiles}
          assignments={assignments}
        />
      )}
    </div>
  );
}

export function KitchenAlertOverlay({ alerts, onConfirm }) {
  if (alerts.length === 0) return null;
  const PAIR_COLORS = {
    Wine:      { color: tokens.ink[2], bg: tokens.neutral[0], border: tokens.ink[4] },
    "Non-Alc": { color: tokens.ink[2], bg: tokens.neutral[0], border: tokens.ink[4] },
    Premium:   { color: tokens.ink[2], bg: tokens.neutral[0], border: tokens.ink[4] },
    "Our Story":{ color: tokens.ink[2], bg: tokens.neutral[0], border: tokens.ink[4] },
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
              if (!extrasMap[ex.key]) extrasMap[ex.key] = { name: ex.name, seats: [], anyShared: false };
              const sw = ex.sharedWith ?? null;
              extrasMap[ex.key].seats.push({ id: s.id, gender: s.gender || null, pairing: ex.pairing, sharedWith: sw });
              if (sw !== null) extrasMap[ex.key].anyShared = true;
            });
          } else {
            // legacy format
            if (s.beet) {
              if (!extrasMap.beetroot) extrasMap.beetroot = { name: "Beetroot", seats: [], anyShared: false };
              extrasMap.beetroot.seats.push({ id: s.id, gender: s.gender || null, pairing: s.beet.pairing, sharedWith: null });
            }
            if (s.cheese) {
              if (!extrasMap.cheese) extrasMap.cheese = { name: "Cheese", seats: [], anyShared: false };
              extrasMap.cheese.seats.push({ id: s.id, gender: s.gender || null, pairing: "—", sharedWith: null });
            }
          }
        });
        const extrasGroups = Object.values(extrasMap);
        const ts = new Date(alert.timestamp);
        const timeStr = `${String(ts.getHours()).padStart(2,"0")}:${String(ts.getMinutes()).padStart(2,"0")}`;
        return (
          <div key={tableId} style={{
            background: tokens.neutral[0], borderRadius: 0, maxWidth: 480, width: "100%",
            border: `1px solid ${tokens.ink[4]}`,
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              background: tokens.neutral[0], padding: "14px 20px",
              borderBottom: `1px solid ${tokens.ink[4]}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontFamily: FONT, fontSize: "14px", fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[0] }}>
                  T{tableId}{alert.tableName ? ` — ${alert.tableName}` : ""}
                </span>
              </div>
              <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], letterSpacing: "0.10em" }}>{timeStr}</span>
            </div>
            {/* Body */}
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pairSeats.length > 0 && (() => {
                // Group seats by pairing type
                const pairingGroups = {};
                pairSeats.forEach(s => {
                  if (!pairingGroups[s.pairing]) pairingGroups[s.pairing] = { seats: [], anyShared: false };
                  pairingGroups[s.pairing].seats.push(s);
                  if (s.pairingSharedWith) pairingGroups[s.pairing].anyShared = true;
                });
                return Object.entries(pairingGroups).map(([pType, group]) => {
                  const c = PAIR_COLORS[pType] || {};
                  return (
                    <div key={pType} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], minWidth: 60 }}>PAIRING</span>
                      {group.seats.map(s => (
                        <span key={s.id} style={{ fontFamily: FONT, fontSize: "10px", padding: "3px 8px", borderRadius: 0, background: c.bg || tokens.neutral[50], border: `1px solid ${c.border || tokens.ink[4]}`, color: c.color || tokens.ink[2] }}>
                          P{s.id} {pType}
                        </span>
                      ))}
                      {group.anyShared && <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.10em", color: tokens.ink[2], padding: "2px 6px", border: `1px solid ${tokens.ink[4]}`, background: tokens.ink[5] }}>SHARE</span>}
                    </div>
                  );
                });
              })()}
              {extrasGroups.map(group => (
                <div key={group.name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], minWidth: 60 }}>
                    {group.name.toUpperCase()}
                  </span>
                  {group.seats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: "10px", padding: "3px 8px", borderRadius: 0, background: tokens.green.bg, border: `1px solid ${tokens.green.border}`, color: tokens.green.text }}>
                      P{s.id}{(() => { const p = extraPairingLabel(s.pairing); return p ? ` · ${p}` : ""; })()}
                    </span>
                  ))}
                  {group.anyShared && <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.10em", color: tokens.ink[2], padding: "2px 6px", border: `1px solid ${tokens.ink[4]}`, background: tokens.ink[5] }}>SHARE</span>}
                </div>
              ))}
              {pairSeats.length === 0 && extrasGroups.length === 0 && (
                <span style={{ fontFamily: FONT, fontSize: "10px", color: tokens.ink[4] }}>No extras noted</span>
              )}
            </div>
            {/* Confirm */}
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${tokens.ink[4]}`, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => onConfirm(tableId)} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.14em", padding: "10px 28px",
                border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
                background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 700, textTransform: "uppercase",
              }}>CONFIRM</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function KitchenBoard({ tables, menuCourses, upd, updMany, profiles = [], assignments = {} }) {
  const activeTables = tables
    .filter(t => t.active && !t.kitchenArchived)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));
  const activeIds = activeTables.map(t => t.id).join(",");

  const [order, setOrder] = useState(() => activeTables.map(t => t.id));
  const [activeId, setActiveId] = useState(null);
  // Width of the ticket being dragged, captured at drag start so the floating
  // DragOverlay matches the grid cell it came from (cells are now fluid).
  const [activeWidth, setActiveWidth] = useState(null);

  const { columns, setColumns } = useKitchenColumns();
  const currentCols = columns === AUTO ? estimateAutoCols() : columns;
  const fewerCols = () => setColumns(Math.max(COLS_MIN, currentCols - 1));
  const moreCols  = () => setColumns(Math.min(COLS_MAX, currentCols + 1));
  const gridTemplateColumns = columns === AUTO
    ? `repeat(auto-fill, minmax(${TICKET_MIN_W}px, 1fr))`
    : `repeat(${columns}, minmax(0, 1fr))`;
  const colBtn = {
    fontFamily: FONT, fontWeight: 500, lineHeight: 1, fontSize: "15px",
    padding: "0 14px", minHeight: 40,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", cursor: "pointer",
    touchAction: "manipulation", userSelect: "none",
  };

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
      <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[4], textAlign: "center", paddingTop: 80 }}>
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

    {/* Column density — pack more tickets on a large screen (crisp, real px). */}
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingBottom: 12 }}>
      <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3] }}>COLUMNS</span>
      <div role="group" aria-label="Kitchen columns" style={{ display: "inline-flex", alignItems: "stretch", border: `1px solid ${tokens.ink[3]}`, background: tokens.neutral[0], overflow: "hidden" }}>
        <button
          onClick={fewerCols}
          disabled={currentCols <= COLS_MIN}
          aria-label="Fewer, larger tickets"
          style={{ ...colBtn, borderRight: `1px solid ${tokens.ink[4]}`, color: currentCols <= COLS_MIN ? tokens.ink[4] : tokens.ink[1], cursor: currentCols <= COLS_MIN ? "default" : "pointer" }}
        >−</button>
        <button
          onClick={() => setColumns(AUTO)}
          title="Tap for Auto (fit to screen)"
          aria-label={columns === AUTO ? `Auto, ${currentCols} columns — tap to keep auto` : `${currentCols} columns — tap for auto`}
          style={{ ...colBtn, minWidth: 60, fontSize: "9px", letterSpacing: "0.06em", color: columns === AUTO ? tokens.ink[3] : tokens.ink[1], fontWeight: columns === AUTO ? 400 : 600 }}
        >{columns === AUTO ? `AUTO · ${currentCols}` : currentCols}</button>
        <button
          onClick={moreCols}
          disabled={currentCols >= COLS_MAX}
          aria-label="More, smaller tickets"
          style={{ ...colBtn, borderLeft: `1px solid ${tokens.ink[4]}`, color: currentCols >= COLS_MAX ? tokens.ink[4] : tokens.ink[1], cursor: currentCols >= COLS_MAX ? "default" : "pointer" }}
        >+</button>
      </div>
    </div>

    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }) => {
        setActiveId(active.id);
        setActiveWidth(active.rect?.current?.initial?.width ?? null);
      }}
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
          <div style={{ display: "grid", gridTemplateColumns, alignItems: "start", gap: TICKET_GAP }}>
            {orderedTables.map(t => (
              <SortableTicket
                key={t.id}
                table={t}
                menuCourses={menuCourses}
                upd={upd}
                isDragging={activeId === t.id}
                anyDragging={activeId !== null}
                profiles={profiles}
                assignments={assignments}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTable && (
          <div style={{
            width: activeWidth || TICKET_MIN_W, borderRadius: 0,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            opacity: 0.97,
          }}>
            <KitchenTicket
              table={activeTable}
              menuCourses={menuCourses}
              upd={upd}
              profiles={profiles}
              assignments={assignments}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
    </>
  );
}
