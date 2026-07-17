import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, MeasuringStrategy, rectIntersection, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { RESTRICTIONS, restrLabel } from "../../constants/dietary.js";
import { optionalPairingsFromCourses, courseRestrictionModCounts } from "../../utils/menuUtils.js";
import { fmt, parseHHMM } from "../../utils/tableHelpers.js";
import { tokens } from "../../styles/tokens.js";
import { getVisibleCoursesForTable } from "../../utils/courseProgress.js";
import { estimateNextFire, fireGapsForTable } from "../../utils/fireCadence.js";
import { gapsForMenuType } from "../../utils/archiveInsights.js";
import { extraPairingLabel, extraPairingForSeat } from "../../constants/pairings.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

// Lazy so the minimap's floor geometry only loads on the large kitchen panel
// that actually shows it — a phone/tablet board never pays for it.
const KitchenMinimap = lazy(() => import("./KitchenMinimap.jsx"));

// Viewport width from which the board uses the dense large-display layout
// (5-up grid + compact tickets). A 32" 1280×720 kitchen panel lands above it;
// tablets and phones stay on the roomy layout.
const LARGE_BOARD_BP = 1100;

// In-ticket dividers. Deliberately softer than the grammar hairline (ink[4]):
// 17 course rows × 5 tickets reads as a glowing grid otherwise. Crucially the
// dividers are NOT borders — sections/rows are solid blocks separated by 1px
// flex gaps over this background. Android's forced dark mode lightens border
// colors (bright grid lines on the panel) but darkens backgrounds, so
// gap-based dividers stay subtle in both light and dark rendering.
const RULE_SOFT = tokens.neutral[200];
const CARD_BORDER = tokens.neutral[300];

const FONT = tokens.font;
// Shared empty-notes fallback — MUST be module-stable (see the comment at its
// use site): an inline {} here re-armed an infinite render loop every render.
const NO_COURSE_NOTES = {};

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

export function KitchenTicket({ table, menuCourses, upd, dragHandleRef, dragListeners, profiles = [], assignments = {}, kitchenTemplate = null, editable = false, quickNotes = {}, compact = false, inlineMods = false, quickAccess = false, roomGaps = [], historyGaps = [] }) {
  // Density. Compact tightens the vertical rhythm so two full rows of tickets
  // fit a 720px-tall kitchen display (32" 1280×720 → 5 columns × 2 rows = 10
  // tickets). Gated to large boards by the caller; the physical pixels on such
  // panels are big, so the tighter type stays readable and tappable.
  const dz = compact ? {
    headerPad: "3px 8px", tNum: "15px", tNumGroup: "12px", nameFont: "9.5px", nameWrap: "nowrap",
    counterFont: "12px", badgePad: "0 3px", showGrip: false,
    rowPad: "2px 8px", paceBtnPad: "3px 7px", seatChipPad: "1px 4px", seatFont: "7.5px", assignBtnPad: "4px 8px",
    coursePad: "1px 8px 1px 6px", courseFont: "9px", courseLH: 1.15, courseGap: 5, courseGlyph: "10px", modsFont: "8.5px",
    footerPad: "4px 10px", archiveBtnPad: "4px 8px",
  } : {
    headerPad: "7px 10px", tNum: "20px", tNumGroup: "15px", nameFont: "11px", nameWrap: "wrap",
    counterFont: "14px", badgePad: "1px 5px", showGrip: true,
    rowPad: "5px 10px", paceBtnPad: "9px 10px", seatChipPad: "2px 5px", seatFont: "8px", assignBtnPad: "9px 10px",
    coursePad: "7px 10px 7px 8px", courseFont: "11px", courseLH: 1.25, courseGap: 7, courseGlyph: "12px", modsFont: "9px",
    footerPad: "7px 12px", archiveBtnPad: "9px 10px",
  };
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const log = table.kitchenLog || {};
  const [assigningRestrIdx, setAssigningRestrIdx] = useState(null);
  // STABLE fallback, never an inline {}: kitchenCourseNotes is a dependency
  // of the draft-sync effect below, and a table without the field (walk-ins,
  // directly-seeded tables — reservation templating is what usually adds it)
  // got a NEW {} identity every render. First re-render after mount → effect
  // fires → setDraftNotes(new {}) → re-render → new {} → … an infinite
  // synchronous render loop that froze the kitchen display the moment such a
  // ticket was on screen and ANY state changed (a fired course, a send).
  const kitchenCourseNotes = table.kitchenCourseNotes || NO_COURSE_NOTES;
  // Edit mode (only when `editable` prop set — i.e. ticket preview in reservations).
  // Per-course edits stage into draftNotes and commit explicitly via the Save button,
  // so the user can review changes before persisting them to the reservation row.
  const [showEdit, setShowEdit] = useState(false);
  const [pickingRestr, setPickingRestr] = useState(null);
  const [customNote, setCustomNote] = useState("");
  const [draftNotes, setDraftNotes] = useState(kitchenCourseNotes);

  // Quick access (live kitchen board only): a TAP on the header opens a drawer
  // for pace / optional extras / dietaries, while HOLD-and-move still drags the
  // ticket (dnd-kit's 200-250ms activation delay separates the two gestures).
  // The pointer guard ignores the synthetic click that can follow a drag.
  const [showQuick, setShowQuick] = useState(false);
  const [quickPick, setQuickPick] = useState(null); // { type: "extra", key, label }
  const [showDietList, setShowDietList] = useState(false);
  const headTap = useRef(null);
  const onHeaderPointerDown = (e) => {
    headTap.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    dragListeners?.onPointerDown?.(e);
  };
  const onHeaderClick = (e) => {
    if (!quickAccess) return;
    const h = headTap.current;
    if (h && (Date.now() - h.t > 500 || Math.abs(e.clientX - h.x) > 12 || Math.abs(e.clientY - h.y) > 12)) return;
    setShowQuick(v => !v);
    setQuickPick(null);
    setShowDietList(false);
  };
  // Functional update (same rule as fire() below): building the array from
  // the render-captured `seats` overwrote whatever landed on the table
  // between render and tap — a fold from another device, a second rapid tap.
  const setExtraOrdered = (key, seatId, ordered) => {
    upd(table.id, "seats", (prev) => (prev || []).map(s => (seatId == null || s.id === seatId)
      ? { ...s, extras: { ...(s.extras || {}), [key]: { ...((s.extras || {})[key] || {}), ordered } } }
      : s));
  };

  useEffect(() => {
    if (!showEdit) setDraftNotes(kitchenCourseNotes);
  }, [showEdit, kitchenCourseNotes]);

  // Functional updates — restrictions are ALLERGY data. Building the next
  // array from the render-captured `restrictions` and writing it whole meant
  // a kitchen "extra spicy" tap could persist an array missing the nut
  // allergy service added a beat earlier (whole-field last-write-wins).
  const addKitchenRestr = (note, seatId) => {
    if (!note?.trim()) return;
    upd(table.id, "restrictions", (prev) =>
      [...(prev || []), { note: note.trim(), pos: (seatId ?? null), kitchenAdded: true }]);
    setPickingRestr(null);
    setCustomNote("");
  };
  const removeKitchenRestr = (origIdx) => {
    upd(table.id, "restrictions", (prev) => (prev || []).filter((_, i) => i !== origIdx));
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
    // Functional update: two fires in quick succession on the same table must
    // both land — building from the render-captured `log` dropped the earlier
    // one when the second click won the race.
    upd(table.id, "kitchenLog", (prev) => ({ ...(prev || {}), [courseKey]: { firedAt: now } }));
    // Firing the course service asked for fulfils the "table is set" signal.
    if (table.courseReady?.key === courseKey) upd(table.id, "courseReady", null);
  };
  const unfire = (courseKey) => {
    upd(table.id, "kitchenLog", (prev) => {
      const newLog = { ...(prev || {}) };
      delete newLog[courseKey];
      return newLog;
    });
  };

  const assignRestrToSeat = (seatId) => {
    if (assigningRestrIdx === null) return;
    upd(table.id, "restrictions", (prev) => (prev || []).map((r, i) =>
      i === assigningRestrIdx ? { ...r, pos: seatId } : r
    ));
    setAssigningRestrIdx(null);
  };

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

  // Optional add-on courses (beetroot, cheese, pear…) offered in the quick
  // drawer. Celebration courses are excluded — the Cake toggle drives those
  // via table.birthday.
  const quickExtraDefs = quickAccess ? (menuCourses || []).reduce((acc, c) => {
    const flag = normFlag(c?.optional_flag);
    if (!flag || normCategory(c) === "celebration") return acc;
    if (!acc.some(d => d.key === flag)) acc.push({ key: flag, label: c?.menu?.name || flag });
    return acc;
  }, []) : [];

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

  // Next-fire countdown — the same cadence intelligence service sees, surfaced
  // where the prep actually happens. Live board only (upd set); estimates more
  // than 45 min overdue are stale data (old service), not a late course.
  const nextEst = (!allDone && upd)
    ? estimateNextFire({ table, courses: visibleCoursesForTable, roomGaps, historyGaps })
    : null;
  const showNextEst = nextEst && nextEst.dueInMin >= -45;

  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p === "Wine" ? "Wine" : p;

  // Slow/Fast pace toggles — offered ONLY in the quick-access drawer (per
  // Djan); the header badge above is the always-visible indicator. They stop
  // pointer events so a tap never starts the header drag.
  const paceButtons = ["Slow", "Fast"].map(p => {
    const colors = { Slow: { on: tokens.ink[0], bg: tokens.neutral[0], border: tokens.charcoal.default }, Fast: { on: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border } };
    const active = table.pace === p;
    const col = colors[p];
    // Stamp who set the pace and when, so service's intelligence rail can show
    // "PACE · SLOW — KITCHEN 19:42" instead of an unattributed flag.
    const setPace = () => {
      if (!upd) return;
      const next = active ? "" : p;
      upd(table.id, "pace", next);
      upd(table.id, "paceBy", next ? "kitchen" : null);
      upd(table.id, "paceAt", next ? fmt(new Date()) : null);
    };
    return (
      <button key={p}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setPace(); }}
        style={{
          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: dz.paceBtnPad,
          border: `1px solid ${active ? col.border : tokens.ink[4]}`,
          borderRadius: 0, cursor: upd ? "pointer" : "default",
          background: active ? col.bg : tokens.neutral[0], color: active ? col.on : tokens.ink[3],
          transition: "all 0.1s", touchAction: "manipulation",
        }}>{p}</button>
    );
  });

  return (
    <div style={{ border: `1px solid ${CARD_BORDER}`, borderRadius: 0, overflow: "hidden", background: RULE_SOFT, display: "flex", flexDirection: "column", gap: 1 }}>

      {/* ── Header (drag handle) ── */}
      <div
        ref={dragHandleRef}
        {...dragListeners}
        onPointerDown={onHeaderPointerDown}
        onClick={onHeaderClick}
        role={dragListeners ? "button" : undefined}
        aria-label={dragListeners ? "Drag to reorder ticket — tap for quick access" : undefined}
        style={{ background: showQuick ? tokens.neutral[50] : tokens.neutral[0], padding: dz.headerPad, display: "flex", alignItems: "flex-start", gap: 8, cursor: quickAccess ? "pointer" : dragListeners ? "grab" : undefined, touchAction: "none" }}
      >
        {dragListeners && dz.showGrip && (
          <span aria-hidden="true" title="Drag to reorder" style={{
            fontFamily: FONT, fontSize: 14, color: tokens.ink[4],
            lineHeight: 1, flexShrink: 0, alignSelf: "center", letterSpacing: -2,
            userSelect: "none",
          }}>⋮⋮</span>
        )}
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? dz.tNumGroup : dz.tNum, fontWeight: 800, color: tokens.ink[0], lineHeight: 1, letterSpacing: "-0.02em", flexShrink: 0 }}>
          {table.displayGroupLabel || table.displayLabel || (table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: dz.nameWrap, overflow: "hidden" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: dz.nameFont, fontWeight: 700, color: tokens.ink[0], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{table.resName}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.08em", padding: dz.badgePad, borderRadius: 0, background: tokens.ink[5], color: tokens.ink[3], flexShrink: 0 }}>{isShort ? "SHORT" : "LONG"}</span>}
            <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.08em", padding: dz.badgePad, borderRadius: 0, background: table.lang === "si" ? tokens.red.bg : tokens.green.bg, color: table.lang === "si" ? tokens.red.text : tokens.green.text, border: "1px solid", borderColor: table.lang === "si" ? tokens.red.border : tokens.green.border, flexShrink: 0 }}>{table.lang === "si" ? "SI" : "EN"}</span>
            {/* Pace badge — on compact boards pace is SET from the quick-access
                drawer, but nothing showed it once the drawer closed. The header
                banner is the ticket's always-visible surface, so the active
                pace lives here (same colors as the toggle buttons). */}
            {table.pace && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: dz.badgePad, borderRadius: 0, flexShrink: 0,
                background: table.pace === "Fast" ? tokens.red.bg : tokens.neutral[0],
                color: table.pace === "Fast" ? tokens.red.text : tokens.ink[0],
                border: `1px solid ${table.pace === "Fast" ? tokens.red.border : tokens.charcoal.default}`,
              }}>{table.pace}</span>
            )}
            {table.birthday && <span style={{ fontSize: "10px" }}>🎂</span>}
            {table.guestType === "hotel" && (() => {
              const rs = Array.isArray(table.rooms) && table.rooms.length ? table.rooms.filter(Boolean) : (table.room ? [table.room] : []);
              return <span style={{ fontFamily: FONT, fontSize: "8px", color: tokens.ink[3], letterSpacing: "0.06em" }}>{rs.length ? `#${rs.join(", ")}` : "Hotel"}</span>;
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: dz.nameWrap, overflow: "hidden", whiteSpace: compact ? "nowrap" : "normal" }}>
            <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 700, color: tokens.ink[0] }}>{seats.length} <span style={{ fontWeight: 400, fontSize: "9px", letterSpacing: "0.06em" }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 600, color: tokens.ink[2] }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 600, color: tokens.green.border }}>arr. {table.arrivedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: dz.counterFont, fontWeight: 700, color: allDone ? tokens.green.border : tokens.ink[0], lineHeight: 1 }}>{firedCount}<span style={{ fontSize: "9px", color: tokens.ink[3], fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: "8px", color: tokens.green.border }}>{durationMins} min</div>}
          {showNextEst && (
            <div style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.06em", whiteSpace: "nowrap", color: nextEst.dueInMin < -2 ? tokens.red.text : tokens.ink[3] }}>
              {nextEst.dueInMin > 1 ? `NEXT ~${nextEst.dueInMin}M` : nextEst.dueInMin >= -2 ? "NEXT DUE" : `OVER ${-nextEst.dueInMin}M`}
            </div>
          )}
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

      {/* ── Quick access drawer (live board only) — tap header to toggle ── */}
      {quickAccess && showQuick && (() => {
        const qLabel = { fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3], flexShrink: 0, minWidth: 30 };
        const qBtn = (active, danger) => ({
          fontFamily: FONT, fontSize: "9px", padding: "5px 8px", borderRadius: 0, cursor: "pointer",
          border: `1px solid ${active ? (danger ? tokens.red.border : tokens.green.border) : tokens.ink[4]}`,
          background: active ? (danger ? tokens.red.bg : tokens.green.bg) : tokens.neutral[0],
          color: active ? (danger ? tokens.red.text : tokens.green.text) : tokens.ink[2],
          fontWeight: active ? 600 : 400, touchAction: "manipulation",
        });
        const allOrdered = (key) => seats.length > 0 && seats.every(s => !!s.extras?.[key]?.ordered);
        return (
          <div style={{ background: tokens.neutral[50], padding: "5px 8px 6px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={qLabel}>PACE</span>
              {paceButtons}
              <span style={{ flex: 1 }} />
              <button onClick={() => { setShowQuick(false); setQuickPick(null); setShowDietList(false); }} aria-label="Close quick access"
                style={{ ...qBtn(false), padding: "5px 9px", color: tokens.ink[3] }}>✕</button>
            </div>
            {quickExtraDefs.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span style={qLabel}>ADD</span>
                {quickExtraDefs.map(d => {
                  const active = (optionalSeatMap[d.key] || []).length > 0;
                  const picking = quickPick?.type === "extra" && quickPick.key === d.key;
                  return (
                    <button key={d.key}
                      onClick={() => { setQuickPick(picking ? null : { type: "extra", key: d.key, label: d.label }); setShowDietList(false); }}
                      style={{ ...qBtn(active), ...(picking ? { border: `1px solid ${tokens.charcoal.default}`, fontWeight: 600 } : {}) }}>
                      {d.label}{active ? ` · ${(optionalSeatMap[d.key] || []).length}` : ""}
                    </button>
                  );
                })}
                <button onClick={() => upd(table.id, "birthday", !table.birthday)} style={qBtn(!!table.birthday)}>
                  🎂 Cake
                </button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={qLabel}>DIET</span>
              <button
                onClick={() => { setShowDietList(v => !v); setQuickPick(null); }}
                style={{ ...qBtn(showDietList, true), fontWeight: 600 }}>
                {showDietList ? "✕ Close" : "+ Add restriction"}
              </button>
            </div>
            {showDietList && (
              <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", paddingTop: 2, borderTop: `1px solid ${RULE_SOFT}` }}>
                {RESTRICTIONS.map(r => (
                  // One tap applies to the whole table (unassigned) — course mods
                  // light up immediately and the ⚠ UNASSIGNED bar lets staff pin
                  // it to a seat afterwards.
                  <button key={r.key}
                    onClick={() => { addKitchenRestr(r.key, null); setShowDietList(false); }}
                    style={qBtn(false, true)}>
                    {r.emoji} {r.label}
                  </button>
                ))}
              </div>
            )}
            {quickPick?.type === "extra" && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", paddingTop: 2, borderTop: `1px solid ${RULE_SOFT}` }}>
                <span style={{ ...qLabel, color: tokens.red.text, minWidth: 0 }}>{quickPick.label} →</span>
                <button onClick={() => { setExtraOrdered(quickPick.key, null, !allOrdered(quickPick.key)); }}
                  style={qBtn(allOrdered(quickPick.key))}>All</button>
                {seats.map(s => {
                  const on = !!s.extras?.[quickPick.key]?.ordered;
                  return (
                    <button key={s.id} onClick={() => setExtraOrdered(quickPick.key, s.id, !on)} style={qBtn(on)}>P{s.id}</button>
                  );
                })}
                <button onClick={() => setQuickPick(null)} style={{ ...qBtn(false), color: tokens.ink[3] }}>✕</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Notes banner ── */}
      {table.notes && (
        <div style={{ background: tokens.tint.parchment, padding: dz.rowPad, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], flexShrink: 0, lineHeight: 1.4 }}>📋</span>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[2], lineHeight: 1.35, fontStyle: "italic" }}>{table.notes}</span>
        </div>
      )}

      {/* ── Ad-hoc restriction editor (ticket-preview only) ── */}
      {editable && showEdit && (
        <div style={{ padding: "8px 10px", background: tokens.neutral[0] }}>
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

      {/* ── Seats ── */}
      <div style={{ background: tokens.neutral[0], padding: dz.rowPad }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
        {seats.map(s => {
            const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
            const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
            const restrShort = k => { const d = RESTRICTIONS.find(r => r.key === k); return d ? d.label : k; };
            const gs = s.gender === "Mr" ? tokens.gender.male : s.gender === "Mrs" ? tokens.gender.female : null;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{
                  fontFamily: FONT, fontSize: dz.seatFont, fontWeight: 700, padding: dz.seatChipPad, borderRadius: 0,
                  background: p ? (pairingBg[p] || tokens.ink[5]) : tokens.ink[5],
                  color: p ? (pairingColor[p] || tokens.ink[2]) : tokens.ink[2],
                  border: `1px solid ${tokens.ink[4]}`,
                  display: "inline-flex", alignItems: "center", gap: compact ? 3 : 4,
                  whiteSpace: "nowrap",
                }}>
                  P{s.id}
                  {gs && <span style={{ fontSize: "7px", fontWeight: 700, padding: "0 3px", background: gs.bg, color: gs.text, letterSpacing: 0 }}>{compact ? (s.gender === "Mr" ? "M" : "F") : s.gender}</span>}
                  {p ? ` · ${pLabel(p)}` : ""}
                </span>
                {restrList.length > 0 && (
                  <span style={{ fontFamily: FONT, fontSize: dz.seatFont, color: tokens.red.text, letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap" }}>{restrList.map(restrShort).join(" · ")}</span>
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
            <div style={{ marginTop: compact ? 3 : 7, paddingTop: compact ? 3 : 7, borderTop: `1px solid ${RULE_SOFT}` }}>
              <div style={{ display: "flex", gap: compact ? 4 : 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.red.text, textTransform: "uppercase", flexShrink: 0 }}>⚠ UNASSIGNED</span>
                {unassigned.map(r => (
                  <span
                    key={r._i}
                    onClick={() => setAssigningRestrIdx(assigningRestrIdx === r._i ? null : r._i)}
                    style={{
                      fontFamily: FONT, fontSize: "8px", padding: dz.assignBtnPad, borderRadius: 0,
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
                      fontFamily: FONT, fontSize: "9px", fontWeight: 700, padding: dz.assignBtnPad,
                      border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation",
                    }}>P{s.id}</button>
                  ))}
                  <button onClick={() => setAssigningRestrIdx(null)} style={{
                    fontFamily: FONT, fontSize: "9px", padding: dz.assignBtnPad,
                    border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0], color: tokens.ink[3], touchAction: "manipulation",
                  }}>cancel</button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── "Table is set" banner — service raised courseReady; stays until
             this course fires (clearing the overlay alert does NOT clear it). */}
      {table.courseReady && !log[table.courseReady.key]?.firedAt && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: dz.rowPad,
          background: tokens.tint.parchment, borderTop: `1px solid ${tokens.signal.active}`,
          borderBottom: `1px solid ${tokens.signal.active}`,
        }}>
          <span style={{ fontFamily: FONT, fontSize: "10px", color: tokens.signal.active, flexShrink: 0 }}>●</span>
          <span style={{
            fontFamily: FONT, fontSize: dz.courseFont, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: tokens.ink[0],
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            SET FOR C{String(table.courseReady.index).padStart(2, "0")} · {table.courseReady.name}
          </span>
          <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], marginLeft: "auto", flexShrink: 0 }}>
            {table.courseReady.at}
          </span>
        </div>
      )}

      {/* ── Courses ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
              // Count per GUEST, not per seat: an unassigned restriction is one
              // prospective guest and reads "1×" from entry, not "N×" broadcast
              // across every chair until it's pinned to a seat.
              const restrCounts = courseRestrictionModCounts(course, seats, restrictions);
              if (restrCounts) Object.assign(counts, restrCounts);
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
              background: fired ? tokens.green.bg : tokens.neutral[0],
              borderLeft: fired ? `4px solid ${tokens.green.border}` : kcNote.name || kcNote.note ? `4px solid ${tokens.red.text}` : "4px solid transparent",
            }}>
              <div
                onClick={() => { if (editable && showEdit) return; fired ? unfire(key) : fire(key); }}
                style={{ display: "flex", alignItems: "center", padding: dz.coursePad, gap: dz.courseGap, cursor: editable && showEdit ? "default" : "pointer" }}>
                <span style={{ fontFamily: FONT, fontSize: dz.courseGlyph, color: fired ? tokens.green.border : tokens.ink[4], flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                {(() => {
                  const hasSub = (pairingAlert || mods || (kcNote.note && showCourseNotes)) && !fired;
                  const nameEl = (
                    <div style={{
                      fontFamily: FONT, fontSize: dz.courseFont, fontWeight: 700, lineHeight: dz.courseLH,
                      color: fired ? tokens.ink[4] : kcNote.name ? tokens.red.text : tokens.ink[0],
                      textDecoration: fired ? "line-through" : "none",
                      letterSpacing: "0.02em",
                      ...(inlineMods ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0, maxWidth: hasSub ? "60%" : "100%" } : {}),
                    }}>
                      {displayName}
                      {kcNote.name && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 400, color: tokens.ink[3], marginLeft: 5 }}>({baseName})</span>}
                      {extraLabel && <span style={{ fontFamily: FONT, fontSize: "8px", fontWeight: 400, color: tokens.ink[4], marginLeft: 6 }}>{extraLabel}</span>}
                    </div>
                  );
                  const modSegments = !hasSub ? [] : [
                    pairingAlert && { text: pairingAlert, color: tokens.ink[3] },
                    ...(mods ? Object.entries(mods).map(([mod, count]) => ({ text: `${count}× ${mod}`, color: tokens.red.text })) : []),
                    (kcNote.note && showCourseNotes) ? { text: `⚑ ${kcNote.note}`, color: tokens.red.text } : null,
                  ].filter(Boolean);
                  if (inlineMods) {
                    // One line per course: dietaries/mods sit beside the name and
                    // ellipsize instead of wrapping to a second row. fontSize and
                    // lineHeight live on the container so its line box hugs the
                    // small type instead of inheriting the 16px browser strut.
                    return (
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                        {nameEl}
                        {modSegments.length > 0 && (
                          <div style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: FONT, fontSize: dz.modsFont, lineHeight: dz.courseLH }}>
                            {modSegments.map((seg, i) => (
                              <span key={i} style={{ color: seg.color, fontWeight: 600 }}>
                                {i > 0 ? " · " : ""}{seg.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {nameEl}
                      {modSegments.length > 0 && (
                        <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                          {modSegments.map((seg, i) => (
                            <span key={i} style={{ fontFamily: FONT, fontSize: dz.modsFont, color: seg.color, fontWeight: 600 }}>{seg.text}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: "10px 10px 12px", background: tokens.neutral[0] }}>
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
          <div style={{ background: tokens.green.bg, borderTop: `2px solid ${tokens.green.border}`, padding: dz.footerPad, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
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
                fontFamily: FONT, fontSize: compact ? 8 : 9, letterSpacing: compact ? 1 : 1.5, padding: dz.archiveBtnPad,
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

export function SortableTicket({ table, menuCourses, upd, isDragging, anyDragging, profiles = [], assignments = {}, compact = false, inlineMods = false, quickAccess = false, roomGaps = [], historyGaps = [], onFocus = null }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  // Touching or hovering a ticket lights this table up on the minimap. This is
  // a passive read of the pointer (no preventDefault / stopPropagation), so it
  // never disturbs the drag-to-reorder or the fire/quick-access taps beneath —
  // it just records "this is the ticket the chef is looking at right now".
  const focus = onFocus ? () => onFocus(table.id) : undefined;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerEnter={focus}
      onPointerDown={focus}
      style={{
        // Fill the grid cell so ticket width tracks the column count.
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
          compact={compact}
          inlineMods={inlineMods}
          quickAccess={quickAccess}
          roomGaps={roomGaps}
          historyGaps={historyGaps}
        />
      )}
    </div>
  );
}

// Upcoming banners join the same sortable grid as the tickets — the expediter
// can drag one out of the way (or slot a party that arrived early wherever the
// wall needs it), exactly like an unexpanded ticket. The whole card is the
// drag handle; the sensors' hold-delay keeps scrolling working. A TAP (same
// gesture split as the ticket header: short, no movement) opens the
// seat-only sheet — the kitchen can seat an arrived party itself.
export function SortableBanner({ table, isDragging, anyDragging, compact = false, onTap = null }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  const tapRef = useRef(null);
  const onPointerDown = (e) => {
    tapRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    listeners?.onPointerDown?.(e);
  };
  const onClick = (e) => {
    if (!onTap) return;
    const h = tapRef.current;
    // Ignore the synthetic click after a drag / long-hold.
    if (h && (Date.now() - h.t > 500 || Math.abs(e.clientX - h.x) > 12 || Math.abs(e.clientY - h.y) > 12)) return;
    onTap(table.id);
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={onPointerDown}
      onClick={onClick}
      role="button"
      aria-label={onTap ? "Tap to seat, drag to reorder" : "Drag to reorder upcoming table"}
      style={{
        width: "100%", minWidth: 0,
        transform: anyDragging && transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition: isDragging ? 'none' : (anyDragging ? transition : undefined),
        userSelect: "none", WebkitUserSelect: "none",
        touchAction: "pan-y", cursor: "grab",
      }}
    >
      {isDragging ? (
        // Ghost placeholder — banner-sized, so the slot stays visible
        <div style={{
          width: "100%", height: "100%", minHeight: 48,
          border: `2px dashed ${tokens.green.border}`, borderRadius: 0,
          background: tokens.green.bg,
        }} />
      ) : (
        <UpcomingBanner table={table} compact={compact} />
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
              {alert.course && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], minWidth: 60 }}>SET FOR</span>
                  <span style={{
                    fontFamily: FONT, fontSize: "13px", fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase", color: tokens.ink[0],
                    padding: "4px 10px", background: tokens.tint.parchment,
                    border: `1px solid ${tokens.signal.active}`,
                  }}>
                    C{String(alert.course.index).padStart(2, "0")} · {alert.course.name}
                  </span>
                </div>
              )}
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
              {pairSeats.length === 0 && extrasGroups.length === 0 && !alert.course && (
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

// Upcoming reservation banner — the ticket's header-level facts only (time,
// table, pax, restrictions…), no courses. It sits in the grid slot the full
// ticket will occupy once the table is seated, so it stays small (dashed
// border = "not in yet") and simply expands in place on the seat.
export function UpcomingBanner({ table: t, compact = false }) {
  const label = t.displayGroupLabel || t.displayLabel || (t.tableGroup?.length > 1 ? `T${t.tableGroup.join("-")}` : `T${t.id}`);
  const pax = t.guests || (t.seats || []).length || 0;
  const isShort = String(t.menuType || "").trim().toLowerCase() === "short";
  const restrNotes = [...new Set((t.restrictions || []).map(r => r?.note).filter(Boolean).map(restrLabel))];
  const rooms = Array.isArray(t.rooms) && t.rooms.length ? t.rooms.filter(Boolean) : (t.room ? [t.room] : []);
  return (
    <div style={{
      border: `1px dashed ${CARD_BORDER}`, borderRadius: 0, background: tokens.neutral[0],
      padding: compact ? "5px 9px" : "7px 11px", display: "flex", flexDirection: "column",
      gap: 3, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
        {t.resTime && <span style={{ fontFamily: FONT, fontSize: compact ? 13 : 14, fontWeight: 800, color: tokens.ink[0], letterSpacing: "-0.01em", flexShrink: 0 }}>{t.resTime}</span>}
        <span style={{ fontFamily: FONT, fontSize: compact ? 11 : 12, fontWeight: 700, color: tokens.ink[1], flexShrink: 0 }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.ink[0], flexShrink: 0 }}>{pax} <span style={{ fontWeight: 400, fontSize: 9, letterSpacing: "0.06em" }}>PAX</span></span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
        {t.menuType && <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 600, letterSpacing: "0.08em", padding: "0 3px", background: tokens.ink[5], color: tokens.ink[3], flexShrink: 0 }}>{isShort ? "SHORT" : "LONG"}</span>}
        {t.resName && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.resName}</span>}
        {t.guestType === "hotel" && <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: "0.06em", flexShrink: 0 }}>{rooms.length ? `#${rooms.join(", ")}` : "Hotel"}</span>}
        {t.birthday && <span style={{ fontSize: 10, flexShrink: 0 }}>🎂</span>}
      </div>
      {restrNotes.length > 0 && (
        <div style={{ fontFamily: FONT, fontSize: 9, fontWeight: 600, color: tokens.red.text, letterSpacing: "0.04em" }}>{restrNotes.join(" · ")}</div>
      )}
    </div>
  );
}

export default function KitchenBoard({ tables, menuCourses, upd, updMany, profiles = [], assignments = {}, historyGapsByMenu = null, persistedOrder = null, onOrderChange = null, onSeat = null, floorMaps = null }) {
  // A party still out on the terrace (t._visit, decorated by App) gets its
  // ticket BEFORE the dining table is seated — the kitchen fires the opening
  // courses from here while the guests are outside.
  const activeTables = tables
    .filter(t => (t.active || t._visit?.visit === "terrace") && !t.kitchenArchived)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));

  // Reservations that haven't been seated yet — slim banner cards that OCCUPY
  // the grid slot their ticket will use, in reservation-time order, so the
  // chef sees what's coming (time, table, pax, restrictions) and the card
  // simply expands into the full ticket when the table is seated (t.active)
  // or the party heads out to the terrace.
  const upcomingTables = tables
    .filter(t => !t.active && t._visit?.visit !== "terrace" && (t.resTime || t.resName))
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));
  const upcomingIds = new Set(upcomingTables.map(t => t.id));
  const displayTables = [...activeTables, ...upcomingTables];
  const displayIds = displayTables.map(t => t.id).join(",");
  // New (unordered) cards slot in by reservation time so a banner sits where
  // its ticket belongs in the night's timeline.
  const timeOrdered = (list) => [...list].sort((a, b) =>
    ((parseHHMM(a.resTime) ?? 24 * 60) - (parseHHMM(b.resTime) ?? 24 * 60)) || (a.id - b.id));

  // Tickets archived while their table/party is still LIVE. Archive was a
  // one-way door from the kitchen's side — a mis-tap hid a live ticket and
  // the only restore lived inside the END SERVICE modal (next to CLEAR ALL,
  // not a surface for mid-service kitchen staff). The strip below is the
  // kitchen's own way back.
  const archivedTables = tables
    .filter(t => (t.active || t._visit?.visit === "terrace") && t.kitchenArchived)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));
  const [showArchived, setShowArchived] = useState(false);

  // Seat-only sheet for a tapped upcoming banner. Deliberately ONE action —
  // the kitchen seats the arrived party (its local-first write works with
  // the wifi down, when no other device's seat can reach this display) and
  // the banner expands into the full ticket. Everything else stays FOH's.
  const [seatSheetId, setSeatSheetId] = useState(null);
  const seatTarget = seatSheetId != null ? upcomingTables.find(t => t.id === seatSheetId) : null;
  useEffect(() => {
    // Auto-close if the table got seated (here or on another device) or the
    // reservation left the board while the sheet was open.
    if (seatSheetId != null && !seatTarget) setSeatSheetId(null);
  }, [seatSheetId, seatTarget]);

  // Seed from the persisted expediter order (it used to be local state only,
  // so a refresh scrambled the board back to table-id order). The order now
  // spans BOTH tickets and upcoming banners — a banner holds the grid slot
  // its ticket will expand into, so seating a table never reshuffles the wall.
  const [order, setOrder] = useState(() => {
    const ids = timeOrdered(displayTables).map(t => t.id);
    if (!Array.isArray(persistedOrder) || persistedOrder.length === 0) return ids;
    const idSet = new Set(ids);
    const kept = persistedOrder.filter(id => idSet.has(id));
    return [...kept, ...ids.filter(id => !kept.includes(id))];
  });

  // Tonight's pooled fire rhythm — feeds each ticket's NEXT ~X MIN countdown.
  const roomGaps = useMemo(() => {
    const gaps = [];
    activeTables.forEach(t => {
      gaps.push(...fireGapsForTable(t, getVisibleCoursesForTable(t, menuCourses, { profiles, assignments })));
    });
    return gaps;
  }, [tables, menuCourses, profiles, assignments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render every minute so idle countdowns keep ticking.
  const [, setCadenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCadenceTick(t => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const [activeId, setActiveId] = useState(null);
  // Width of the dragged ticket, captured at drag start so the floating overlay
  // matches the grid cell it came from (cells are now fluid, not a fixed 248px).
  const [activeWidth, setActiveWidth] = useState(null);
  // Large display (e.g. 32" 1280×720 panel): always the compact 5-column
  // layout, regardless of how few tickets are up. Scaling tickets up to fill
  // the screen at low counts made them sprawl past the fold with real menus
  // (19 courses + extras), so consistency beats fill: a ticket is always the
  // same size and a full board is two rows of five.
  const largeBoard = !useIsMobile(LARGE_BOARD_BP);
  const compact = largeBoard;

  // The ticket the chef is currently touching/hovering — drives the minimap
  // highlight. Kept even after the pointer leaves (the last-touched table
  // stays lit) so the map is a stable plating reference, not a flicker.
  const [focusedTableId, setFocusedTableId] = useState(null);
  // The minimap lives in the empty bottom-right of the board and must NEVER
  // push a ticket. Only the large kitchen panel runs the fixed 5-up grid where
  // "spare space" is well defined; there, a full wall is exactly two rows of
  // five (10 cards), so the map shows at ≤9 cards and the 10th card reclaims
  // its cell. It renders as a normal grid child forced to the last column, so
  // it always lands on a free right-edge cell and can't overlap a card.
  const showMinimap = largeBoard && !!floorMaps && displayTables.length <= 9;

  // Keep order in sync when tables/banners are added/removed. A seated table
  // keeps the slot its banner held; brand-new cards slot in by time.
  useEffect(() => {
    setOrder(prev => {
      const idSet = new Set(displayTables.map(t => t.id));
      const kept = prev.filter(id => idSet.has(id));
      const added = timeOrdered(displayTables.filter(t => !kept.includes(t.id))).map(t => t.id);
      return [...kept, ...added];
    });
  }, [displayIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Adopt another device's reordering (realtime push) — but never mid-drag.
  const persistedOrderJson = JSON.stringify(persistedOrder || []);
  useEffect(() => {
    if (activeId) return; // a drag is in progress — local hand wins
    if (!Array.isArray(persistedOrder) || persistedOrder.length === 0) return;
    setOrder(prev => {
      const idSet = new Set(displayTables.map(t => t.id));
      const kept = persistedOrder.filter(id => idSet.has(id));
      const added = prev.filter(id => idSet.has(id) && !kept.includes(id));
      const next = [...kept, ...added];
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [persistedOrderJson, displayIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const pendingAlerts = tables
    .filter(t => t.kitchenAlert && !t.kitchenAlert.confirmed)
    .map(t => ({ tableId: t.id, alert: t.kitchenAlert }));

  const confirmAlert = (tableId) => {
    // Advance the acknowledged baseline to the snapshot this alert carried, so
    // the next service Send only pings about what's new after it. Older alerts
    // (pre-snapshot) just clear without touching the baseline.
    const snap = pendingAlerts.find(a => a.tableId === tableId)?.alert?.snapshot;
    updMany(tableId, snap ? { kitchenAlert: null, kitchenSent: snap } : { kitchenAlert: null });
  };

  // Rendered in BOTH branches below — with every live ticket archived the
  // grid is empty, and that is exactly when the way back matters most.
  const archivedStrip = archivedTables.length > 0 && (
    <div style={{ marginTop: 14, borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 8 }}>
      <button
        onClick={() => setShowArchived(v => !v)}
        style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
          padding: "7px 12px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
          background: tokens.neutral[0], color: tokens.ink[3], cursor: "pointer", touchAction: "manipulation",
        }}
      >ARCHIVED ({archivedTables.length}) {showArchived ? "▾" : "▸"}</button>
      {showArchived && archivedTables.map(t => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", marginTop: 6,
          border: `1px solid ${tokens.ink[5]}`, background: tokens.neutral[50],
        }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.ink[1] }}>
            T{String(t.id).padStart(2, "0")}
          </span>
          {t.resName && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>{t.resName}</span>}
          <span style={{ flex: 1 }} />
          {upd && (
            <button
              onClick={() => upd(t.id, "kitchenArchived", false)}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "6px 14px", border: `1px solid ${tokens.green.border}`, borderRadius: 0,
                background: tokens.green.bg, color: tokens.green.text, fontWeight: 700,
                cursor: "pointer", touchAction: "manipulation",
              }}
            >RESTORE</button>
          )}
        </div>
      ))}
    </div>
  );

  if (displayTables.length === 0) return (
    <>
      <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[4], textAlign: "center", paddingTop: 80 }}>
        No active tables
      </div>
      {archivedStrip}
      <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
    </>
  );

  const orderedTables = order.map(id => displayTables.find(t => t.id === id)).filter(Boolean);
  // Banners drag too, so the overlay's source is the full display list.
  const activeTable  = activeId ? displayTables.find(t => t.id === activeId) : null;

  return (
    <>
    <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
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
        // Persist outside the state updater: updaters must stay pure
        // (StrictMode runs them twice, which would double-save).
        const from = order.indexOf(active.id);
        const to   = order.indexOf(over.id);
        if (from < 0 || to < 0) return;
        const next = arrayMove(order, from, to);
        setOrder(next);
        // The expediter's ordering survives refreshes and reaches the other
        // kitchen screens via service_settings.
        onOrderChange?.(next);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div style={{ paddingBottom: 8 }}>
          {/* Responsive grid. Large boards (≥1100px, e.g. a 32" 1280×720 panel)
              always run 5 fixed columns so 10 tickets show as two full rows
              and a sparse board keeps the same ticket size. Narrower screens
              auto-fill. Upcoming banners share the grid: each one holds the
              cell its ticket expands into on seating. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: largeBoard
              ? "repeat(5, minmax(0, 1fr))"
              : "repeat(auto-fill, minmax(210px, 1fr))",
            alignItems: "start",
            gap: compact ? 8 : 12,
          }}>
            {orderedTables.map(t => upcomingIds.has(t.id) ? (
              <SortableBanner
                key={t.id}
                table={t}
                isDragging={activeId === t.id}
                anyDragging={activeId !== null}
                compact={compact}
                onTap={onSeat && upd ? setSeatSheetId : null}
              />
            ) : (
              <SortableTicket
                key={t.id}
                table={t}
                menuCourses={menuCourses}
                upd={upd}
                isDragging={activeId === t.id}
                anyDragging={activeId !== null}
                profiles={profiles}
                assignments={assignments}
                compact={compact}
                inlineMods={largeBoard}
                quickAccess={!!upd}
                roomGaps={roomGaps}
                historyGaps={gapsForMenuType(historyGapsByMenu, t.menuType)}
                onFocus={showMinimap ? setFocusedTableId : null}
              />
            ))}
            {/* Minimap — forced to the last grid column so it always resolves
                to a free right-edge cell after the tickets flow in, never
                over one. Only rendered when the board has spare cells. */}
            {showMinimap && (
              <div style={{ gridColumn: 5, minWidth: 0, display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
                <Suspense fallback={null}>
                  <KitchenMinimap
                    floorMaps={floorMaps}
                    tables={displayTables}
                    focusedTableId={focusedTableId}
                  />
                </Suspense>
              </div>
            )}
          </div>
          {archivedStrip}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTable && (
          <div style={{
            width: activeWidth || 234, borderRadius: 0,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            opacity: 0.97,
          }}>
            {upcomingIds.has(activeTable.id) ? (
              <UpcomingBanner table={activeTable} compact={compact} />
            ) : (
              <KitchenTicket
                table={activeTable}
                menuCourses={menuCourses}
                upd={upd}
                profiles={profiles}
                assignments={assignments}
                compact={compact}
                inlineMods={largeBoard}
              />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
    {seatTarget && onSeat && (
      <>
        <div onClick={() => setSeatSheetId(null)}
          style={{ position: "fixed", inset: 0, background: tokens.surface.overlay, zIndex: 60 }} />
        <div role="dialog" aria-label="Seat table" style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 61,
          maxWidth: 520, margin: "0 auto", background: tokens.neutral[0],
          borderTop: `2px solid ${tokens.ink[0]}`,
          padding: "14px 18px calc(24px + env(safe-area-inset-bottom))",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em" }}>
              {seatTarget.displayGroupLabel || seatTarget.displayLabel || (seatTarget.tableGroup?.length > 1 ? `T${seatTarget.tableGroup.join("-")}` : `T${seatTarget.id}`)}
            </span>
            {seatTarget.resTime && (
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.ink[1] }}>{seatTarget.resTime}</span>
            )}
            {seatTarget.resName && (
              <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[3], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{seatTarget.resName}</span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
              {seatTarget.guests || (seatTarget.seats || []).length || 0} <span style={{ fontWeight: 400, fontSize: 9, letterSpacing: "0.06em" }}>PAX</span>
            </span>
            <button onClick={() => setSeatSheetId(null)}
              style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 32, height: 32, cursor: "pointer", borderRadius: 0 }}>
              ✕
            </button>
          </div>
          {/* ONE action, deliberately: the kitchen seats the arrived party
              (works offline — local-first write) and the banner expands into
              its ticket. Guest details stay a FOH surface. */}
          <button
            onClick={() => { onSeat(seatTarget.id); setSeatSheetId(null); }}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 13, letterSpacing: "0.14em",
              textTransform: "uppercase", fontWeight: 700, padding: "16px 0",
              border: `1px solid ${tokens.green.border}`, background: tokens.green.bg,
              color: tokens.green.text, borderRadius: 0, cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            SEAT TABLE
          </button>
        </div>
      </>
    )}
    </>
  );
}
