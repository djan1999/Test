import { useMemo, useState } from "react";
import { generateWeeklyReservationsHTML, generateWeeklyAllergyHTML, generateKitchenTicketsHTML } from "../../utils/weeklyPrintGenerator.js";
import { blankTable, makeSeats } from "../../utils/tableHelpers.js";
import { getCourseMod } from "../../utils/menuUtils.js";
import { RESTRICTIONS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin, circleButton } from "../../styles/mixins.js";
import ServiceDatePicker from "./ServiceDatePicker.jsx";
import ResvForm from "./ResvForm.jsx";
import { KitchenTicket } from "../kitchen/KitchenBoard.jsx";
import ServiceBreakdown from "../ServiceBreakdown.jsx";
import GlobalStyle from "../ui/GlobalStyle.jsx";
import { useFocusChain } from "../../hooks/useFocusChain.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const fieldLabel = { ...fieldLabelMixin };
const circBtnSm = { ...circleButton };
const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const SITTING_TIMES = String(import.meta.env.VITE_DEFAULT_SITTING_TIMES || "18:00,18:30,19:00,19:15").split(",").map(s => s.trim()).filter(Boolean);
const ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23").split(",").map(s => s.trim()).filter(Boolean);
const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// ── Weekly overview helpers ──────────────────────────────────────────────────
function buildWeeklyRows(reservations, weekDays, restrictionDefs = []) {
  const toDs = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const fmtS = ds => { const d = new Date(ds+"T00:00:00"); return `${d.getDate()}.${pad2(d.getMonth()+1)}.`; };
  const fmtF = ds => { const d = new Date(ds+"T00:00:00"); return `${d.getDate()}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`; };
  const weekStart = toDs(weekDays[0]), weekEnd = toDs(weekDays[6]);
  const weekResv = reservations
    .filter(r => r.date >= weekStart && r.date <= weekEnd)
    .sort((a,b) => a.date.localeCompare(b.date) || (a.data?.resTime||"99").localeCompare(b.data?.resTime||"99"));
  const byDate = {};
  weekResv.forEach(r => { (byDate[r.date] = byDate[r.date]||[]).push(r); });
  const totalGuests = weekResv.reduce((a,r) => a+(r.data?.guests||2), 0);
  const sorted = Object.keys(byDate).sort();
  const dateRange = sorted.length ? `${fmtS(sorted[0])} - ${fmtF(sorted[sorted.length-1])}` : "";
  const expLabel = r => r.data?.menuType === "short" ? "SM" : `L${String(new Date(r.date+"T00:00:00").getFullYear()).slice(-2)}`;
  const roomsOf = d => {
    if (Array.isArray(d.rooms) && d.rooms.length) return d.rooms.filter(Boolean);
    if (d.room) return [d.room];
    return [];
  };
  const infoTxt = d => {
    const rs = roomsOf(d);
    return [
      d.guestType === "hotel" && rs.length ? `Hotel #${rs.join(", ")}` : "",
      d.birthday ? `1xCAKE${d.cakeNote?`(${d.cakeNote})`:""}` : "",
      d.notes || "",
    ].filter(Boolean).join("\n");
  };
  const restrTxt = rs => {
    if (!rs?.length) return "";
    const c = {};
    rs.forEach(r => { c[r.note] = (c[r.note]||0)+1; });
    return Object.entries(c).map(([k,n]) => {
      const def = restrictionDefs.find(d => d.key===k);
      return `${n}x ${def ? def.label : k}`;
    }).join("\n");
  };
  const rows = [];
  for (const ds of sorted) {
    const dr = byDate[ds];
    const dg = dr.reduce((a,r) => a+(r.data?.guests||2), 0);
    rows.push({ id:`D${ds}`, type:"date", cells:[fmtS(ds), `Total\nguest:\n${dg}`, "", "", "", "", ""] });
    const lr = dr.filter(r => (r.data?.resTime||"") < "15:00");
    const nr = dr.filter(r => (r.data?.resTime||"") >= "15:00");
    const split = lr.length > 0 && nr.length > 0;
    const addRows = (list, sub) => {
      if (sub) rows.push({ id:`S${ds}${sub}`, type:"sub", cells:[sub,"","","","","",""] });
      list.forEach(r => {
        const d = r.data||{};
        rows.push({ id:`R${r.id}`, type:"resv", cells:["", String(d.guests||2), d.resTime||"", d.resName||"—", expLabel(r), infoTxt(d), restrTxt(d.restrictions)] });
      });
    };
    if (split) { addRows(lr,"LUNCH"); addRows(nr,"DINNER"); }
    else addRows(dr, null);
  }
  return { rows, totalGuests, dateRange };
}

const WEEKLY_RESV_HTML_SHELL = (body) => {
  const ROBOTO = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Reservations</title>${ROBOTO}<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Roboto Mono',monospace;font-size:9pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{size:A4 portrait;margin:12mm 10mm}@media print{body{margin:0}}table{width:100%;border-collapse:collapse;table-layout:fixed}col.c0{width:11%}col.c1{width:9%}col.c2{width:9%}col.c3{width:16%}col.c4{width:8%}col.c5{width:22%}col.c6{width:25%}tr{page-break-inside:avoid}th,td{border:1px solid #aaa;padding:4pt 5pt;vertical-align:top;text-align:center;font-size:8.5pt;color:#000;font-weight:700;overflow:hidden;word-wrap:break-word}th{background:#fff}.date-row td{background:#f0f0f0}u{text-decoration:underline;color:#000}h1{font-size:11pt;text-align:center;margin:0 0 2pt;font-weight:700}h2{font-size:9pt;text-align:center;margin:0 0 10pt;font-weight:700}</style></head><body>${body}</body></html>`;
};

function weeklyRowsToHTML(rows, edits, totalGuests, dateRange) {
  const e = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const gc = (rowId, ci) => edits[`${rowId}-${ci}`]!==undefined ? edits[`${rowId}-${ci}`] : (rows.find(r=>r.id===rowId)?.cells[ci]??"");
  let body = `<h1>Reservations : ${e(dateRange)}</h1><h2>Guest count : ${totalGuests}</h2><table><colgroup>${[0,1,2,3,4,5,6].map(i=>`<col class="c${i}">`).join("")}</colgroup>`;
  body += `<tr><th>DATE</th><th>COVER</th><th>TIME</th><th>NAME</th><th>EXP.</th><th>INFO</th><th>ALLERGIES/<br>RESTRICTIONS</th></tr>`;
  for (const row of rows) {
    const c = row.cells.map((_,ci) => gc(row.id, ci));
    if (row.type==="date")
      body += `<tr class="date-row"><td>${e(c[0])}</td><td style="white-space:pre-line;">${e(c[1])}</td><td></td><td></td><td></td><td></td><td></td></tr>`;
    else if (row.type==="sub")
      body += `<tr><td>${e(c[0])}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
    else
      body += `<tr><td></td><td>${e(c[1])}</td><td>${e(c[2])}</td><td>${e(c[3])}</td><td><u>${e(c[4])}</u></td><td style="white-space:pre-line;">${e(c[5])}</td><td style="white-space:pre-line;">${e(c[6])}</td></tr>`;
  }
  body += `</table>`;
  return WEEKLY_RESV_HTML_SHELL(body);
}

function allergyBaseCell(course, resv) {
  const d = resv.data || {};
  const key = course.course_key || "";
  const kcNote = d.kitchenCourseNotes?.[key];
  const restrictions = d.restrictions || [];
  if (kcNote?.name || kcNote?.note) return [kcNote.name, kcNote.note].filter(Boolean).join("\n");
  if (restrictions.length > 0) {
    const modCounts = {};
    // Each restriction entry represents one guest. Restrictions explicitly
    // assigned to the same seat (pos > 0) are grouped so the resolver can
    // produce a combined substitute. Unassigned (pos null) are each one guest.
    const seatGroups = new Map();
    const unassigned = [];
    restrictions.forEach(rs => {
      if (rs.pos) {
        const arr = seatGroups.get(rs.pos) || [];
        arr.push(rs.note);
        seatGroups.set(rs.pos, arr);
      } else {
        unassigned.push([rs.note]);
      }
    });
    [...seatGroups.values(), ...unassigned].forEach(notes => {
      const mod = getCourseMod(course, notes);
      if (mod) modCounts[mod] = (modCounts[mod] || 0) + 1;
    });
    if (Object.keys(modCounts).length > 0)
      return Object.entries(modCounts).map(([mod, count]) => `${count}x ${mod.toLowerCase()}`).join("\n");
  }
  return "";
}

const ALLERGY_ROBOTO = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">`;

function generateAllergyHTMLWithEdits(weekResv, allergyTableCourses, allergyEdits, restrictionDefs) {
  const resvCount = weekResv.length;
  if (!resvCount) return `<!DOCTYPE html><html><body style="font-family:monospace;padding:40pt;text-align:center;">No restrictions or edits this week</body></html>`;
  const escH = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const fmtS = ds => { const d = new Date(ds+"T00:00:00"); return `${d.getDate()}.${String(d.getMonth()+1).padStart(2,"0")}.`; };
  const dates = [...new Set(weekResv.map(r => r.date))].sort();
  const dateRange = dates.length ? `${fmtS(dates[0])}-${fmtS(dates[dates.length-1])}` : "";
  const isLarge = resvCount > 5;
  const baseFontPt = isLarge ? (resvCount <= 7 ? 6.5 : resvCount <= 9 ? 5.5 : 5) : 8;
  const courseSubPt = Math.max(baseFontPt - 1.5, 4);
  const cellPad = isLarge ? "1.5pt 3pt" : "2pt 4pt";
  const tableLayout = isLarge ? "width:100%;table-layout:fixed;" : "width:auto;table-layout:auto;";
  const courseColPct = resvCount <= 5 ? "22%" : resvCount <= 7 ? "18%" : "15%";
  const resvColPct = `${Math.floor((100 - parseInt(courseColPct)) / resvCount)}%`;
  const courseCS = isLarge ? `width:${courseColPct};text-align:left;padding-left:6pt;` : `min-width:110pt;text-align:left;padding-left:6pt;`;
  const resvCS = isLarge ? `width:${resvColPct};text-align:center;` : `min-width:90pt;text-align:center;`;
  const css = `*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Roboto Mono',monospace;font-size:${baseFontPt}pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{size:A4 landscape;margin:5mm 5mm;}@media print{body{margin:0;}}table{border-collapse:collapse;${tableLayout}}th,td{border:1px solid #aaa;padding:${cellPad};vertical-align:top;text-align:left;font-size:${baseFontPt}pt;color:#000;font-weight:700;overflow:hidden;word-wrap:break-word;line-height:1.15;}th{text-align:center;}.green-header{background:#3d6b4f;color:#fff;}.green-header th,.green-header td{border-color:#2e5a3e;color:#fff;}.highlight{background:#edf7ef;}.opt-row{background:#fafafa;}.course-name{text-transform:uppercase;font-size:${baseFontPt}pt;}.course-sub{font-size:${courseSubPt}pt;color:#555;font-weight:400;}.resv-cell{font-size:${baseFontPt}pt;line-height:1.15;white-space:pre-line;}`;
  let body = `<table><tr class="green-header"><th style="${courseCS}">${escH(allergyEdits["hdr-date"] ?? dateRange)}</th>`;
  weekResv.forEach(r => { body += `<th style="${resvCS}">${escH(allergyEdits[`name-${r.id}`] ?? (r.data?.resName || "—"))}</th>`; });
  body += `</tr><tr><td style="padding-left:6pt;">Date</td>`;
  weekResv.forEach(r => { body += `<td style="text-align:center;">${fmtS(r.date)}</td>`; });
  body += `</tr><tr><td style="padding-left:6pt;font-weight:700;">Allergies/Restrictions</td>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    const mt = d.menuType === "short" ? "SHORT MENU" : "LONG MENU";
    const rc = {};
    (d.restrictions || []).forEach(rs => { rc[rs.note] = (rc[rs.note] || 0) + 1; });
    const rLines = Object.entries(rc).map(([k, n]) => { const def = restrictionDefs.find(x => x.key === k); return `${n}x ${def ? def.label.toLowerCase() : k}`; });
    const val = allergyEdits[`restr-${r.id}`] ?? `${mt}\n${rLines.join(", ")}`;
    body += `<td style="text-align:center;white-space:pre-line;">${escH(val)}</td>`;
  });
  body += `</tr>`;
  allergyTableCourses.forEach(course => {
    const key = course.course_key || "";
    const isOpt = String(course.course_category || "main") !== "main";
    const baseName = course.menu?.name || key;
    const baseSub = course.menu?.sub || "";
    body += `<tr${isOpt ? ` class="opt-row"` : ""}><td style="padding-left:6pt;"><span class="course-name">${escH(baseName)}${isOpt ? ` <span style="font-weight:400;font-size:smaller;color:#999;">(opt)</span>` : ""}</span>${baseSub ? `<br><span class="course-sub">${escH(baseSub)}</span>` : ""}</td>`;
    weekResv.forEach(r => {
      const ck = `${key}-${r.id}`;
      const base = allergyBaseCell(course, r);
      const val = allergyEdits[ck] ?? base;
      body += `<td class="resv-cell${val ? " highlight" : ""}${isOpt && !val ? " opt-row" : ""}">${escH(val)}</td>`;
    });
    body += `</tr>`;
  });
  body += `</table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Allergy Sheet</title>${ALLERGY_ROBOTO}<style>${css}</style></head><body>${body}</body></html>`;
}

export default function ReservationManager({ reservations, menuCourses, tables, onUpsert, onDelete, onUpdReservation, onExit, serviceDate, onSetServiceDate }) {
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);   // "YYYY-MM-DD" or null (week view)
  const [editingId,   setEditingId]   = useState(null);   // reservation id being edited, or "new"
  const [ticketId,    setTicketId]    = useState(null);    // reservation id showing kitchen preview
  const [weeklyPreview, setWeeklyPreview] = useState(null); // "reservations" | "allergies" | null
  const [weeklyEdits,   setWeeklyEdits]   = useState({});
  const [allergyEdits,  setAllergyEdits]  = useState({});
  const [draftFromReservation, setDraftFromReservation] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const weeklyChain = useFocusChain();
  // Escape = back at every sub-level. useModalEscape stacks handlers so the
  // most recently enabled one fires first (inner layers pop before outer).
  useModalEscape(() => {
    setSelectedDay(null);
    setEditingId(null);
    setTicketId(null);
    setDraftFromReservation(null);
  }, !!selectedDay);
  useModalEscape(() => setEditingId(null), !!editingId);
  useModalEscape(() => setTicketId(null), !!ticketId);
  useModalEscape(() => setShowBreakdown(false), showBreakdown);
  useModalEscape(() => setWeeklyPreview(null), !!weeklyPreview);

  const todayStr = toLocalDateISO();

  // ── Week helpers ─────────────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const today = new Date();
    const dow   = today.getDay();
    const toMon = dow === 0 ? -6 : 1 - dow;
    const mon   = new Date(today);
    mon.setDate(today.getDate() + toMon + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const toDateStr = d => toLocalDateISO(d);
  const fmtRange  = () => {
    const o = { day: "numeric", month: "short" };
    return `${weekDays[0].toLocaleDateString("en-GB", o)} – ${weekDays[6].toLocaleDateString("en-GB", o)}`.toUpperCase();
  };

  const navBtn = { fontFamily: FONT, fontSize: "11px", padding: "10px 10px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2], touchAction: "manipulation" };

  const resvForDate = (ds) => reservations
    .filter(r => r.date === ds)
    .sort((a, b) => (a.data?.resTime || "99:99").localeCompare(b.data?.resTime || "99:99"));

  // ── DAY DETAIL VIEW ──────────────────────────────────────────────────────
  if (selectedDay) {
    const dayDate   = new Date(selectedDay + "T00:00:00");
    const dayLabel  = dayDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
    const dayResv   = resvForDate(selectedDay);
    const isService = selectedDay === serviceDate;
    const totalGuests = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);

    // Kitchen ticket preview for a reservation
    const ticketResv = ticketId ? dayResv.find(r => r.id === ticketId) : null;
    const ticketVirtualTable = ticketResv ? {
      ...blankTable(ticketResv.table_id),
      ...(ticketResv.data || {}),
      id: ticketResv.table_id,
      seats: makeSeats(ticketResv.data?.guests || 2, ticketResv.data?.seats || []),
    } : null;

    const updForTicket = (tid, field, value) => {
      if (ticketResv) onUpdReservation(ticketResv.id, tid, field, value);
    };

    return (
      <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
        <GlobalStyle />

        {/* Sticky header */}
        <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: tokens.neutral[0], zIndex: 50, gap: 12 }}>
          <button onClick={() => { setSelectedDay(null); setEditingId(null); setTicketId(null); setDraftFromReservation(null); }}
            style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "10px 14px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[1], flexShrink: 0, touchAction: "manipulation" }}>← WEEK</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: isService ? tokens.green.text : tokens.ink[0], fontWeight: 600 }}>{dayLabel}</div>
            <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", color: tokens.ink[3], marginTop: 3 }}>
              {dayResv.length} reservation{dayResv.length !== 1 ? "s" : ""} · {totalGuests} guests
              {isService && <span style={{ color: tokens.green.text, marginLeft: 6 }}>● ACTIVE SERVICE</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setShowBreakdown(true)}
              disabled={dayResv.length === 0}
              style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "10px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: dayResv.length === 0 ? "not-allowed" : "pointer", background: tokens.neutral[0], color: tokens.ink[0], fontWeight: 600, opacity: dayResv.length === 0 ? 0.35 : 1, touchAction: "manipulation" }}>SERVICE BREAKDOWN</button>
            <button
              disabled={dayResv.length === 0}
              onClick={() => {
                const html = generateKitchenTicketsHTML(dayResv, menuCourses, RESTRICTIONS);
                const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
                const w = window.open(url, "_blank");
                if (!w) { alert("Pop-up blocked — please allow pop-ups for this site"); return; }
                setTimeout(() => URL.revokeObjectURL(url), 30000);
              }}
              style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "10px 10px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: dayResv.length === 0 ? "not-allowed" : "pointer", background: tokens.neutral[0], color: tokens.ink[0], fontWeight: 600, opacity: dayResv.length === 0 ? 0.35 : 1, touchAction: "manipulation" }}>PRINT TICKETS</button>
            <button onClick={() => {
              const next = editingId === "new" ? null : "new";
              setEditingId(next);
              setDraftFromReservation(null);
            }}
              style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "10px 14px", border: `1px solid ${tokens.ink[0]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[0], fontWeight: 600, touchAction: "manipulation" }}>[+] ADD</button>
          </div>
        </div>

        {showBreakdown && (
          <ServiceBreakdown
            dateStr={selectedDay}
            reservations={dayResv}
            onClose={() => setShowBreakdown(false)}
          />
        )}

        <div style={{ padding: "16px 16px 60px", maxWidth: 700, margin: "0 auto" }}>

          {/* New reservation form */}
          {editingId === "new" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[3], marginBottom: 6, textTransform: "uppercase" }}>[NEW RESERVATION]</div>
              <ResvForm
                initial={draftFromReservation
                  ? { date: selectedDay, table_id: draftFromReservation.table_id ?? null, data: draftFromReservation.data || {} }
                  : { date: selectedDay, table_id: null, data: {} }}
                tables={tables}
                reservations={reservations}
                excludeId={null}

                onSave={async (row) => { const r = await onUpsert(row); if (r?.ok) { setEditingId(null); setDraftFromReservation(null); } }}
                onCancel={() => { setEditingId(null); setDraftFromReservation(null); }}
              />
            </div>
          )}

          {/* Existing reservations as big clear cards */}
          {dayResv.length === 0 && editingId !== "new" && (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.ink[4] }}>
              <div style={{ fontFamily: FONT, fontSize: "24px", marginBottom: 12, letterSpacing: "0.10em" }}>[ ]</div>
              <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[3] }}>NO RESERVATIONS</div>
              <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 6, color: tokens.ink[4] }}>Tap [+] ADD to create one</div>
            </div>
          )}

          {dayResv.map(r => {
            const d = r.data || {};
            const group = d.tableGroup?.length > 1 ? d.tableGroup.map(Number) : [r.table_id];
            const tLabel = group.length > 1
              ? `T${[...group].sort((a, b) => a - b).join("-")}`
              : `T${String(r.table_id).padStart(2, "0")}`;
            const isEditing = editingId === r.id;
            const showTicket = ticketId === r.id;

            return (
              <div key={r.id} style={{
                borderTop: `1px solid ${tokens.ink[4]}`,
                borderRight: `1px solid ${tokens.ink[4]}`,
                borderBottom: `1px solid ${tokens.ink[4]}`,
                borderLeft: `3px solid ${d.restrictions?.length > 0 ? tokens.red.border : tokens.ink[4]}`,
                borderRadius: 0, marginBottom: 10,
                background: tokens.neutral[0], overflow: "hidden",
              }}>
                {/* Card header — always visible */}
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Table badge */}
                  <div style={{ background: tokens.neutral[50], color: tokens.ink[0], border: `1px solid ${tokens.charcoal.border}`, fontFamily: FONT, fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", padding: "8px 12px", borderRadius: 0, minWidth: 48, textAlign: "center" }}>{tLabel}</div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT, fontSize: "13px", color: tokens.ink[0], fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.resName || "—"}
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.06em", color: tokens.ink[3], marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {d.resTime && <span>{d.resTime}</span>}
                      <span>{d.guests || 2} guests</span>
                      {d.menuType && <span style={{ color: tokens.ink[2], textTransform: "uppercase", letterSpacing: "0.08em" }}>{d.menuType}</span>}
                      {d.lang === "si" && <span style={{ color: tokens.ink[3] }}>SLO</span>}
                      {d.birthday && <span>🎂{d.cakeNote ? ` ${d.cakeNote}` : ""}</span>}
                      {d.guestType === "hotel" && (() => {
                        const rs = Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []);
                        return rs.length ? <span style={{ color: tokens.ink[2] }}>Room{rs.length > 1 ? "s" : ""} #{rs.join(", ")}</span> : null;
                      })()}
                    </div>
                    {d.restrictions?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {d.restrictions.map((rs, i) => {
                          const def = RESTRICTIONS.find(x => x.key === rs.note);
                          return <span key={i} style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em", color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, borderRadius: 0, padding: "2px 6px" }}>{def ? `${def.emoji} ${def.label}` : rs.note}</span>;
                        })}
                      </div>
                    )}
                    {d.notes && <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.04em", color: tokens.ink[3], fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.notes}</div>}
                  </div>
                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => { setEditingId(isEditing ? null : r.id); if (!isEditing) setTicketId(null); }}
                      style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "9px 10px", border: "1px solid " + (isEditing ? tokens.charcoal.default : tokens.ink[4]), borderRadius: 0, cursor: "pointer", background: isEditing ? tokens.tint.parchment : tokens.neutral[0], color: isEditing ? tokens.ink[0] : tokens.ink[2], touchAction: "manipulation" }}>EDIT</button>
                    <button onClick={() => { setTicketId(showTicket ? null : r.id); if (!showTicket) setEditingId(null); }}
                      style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "9px 10px", border: "1px solid " + (showTicket ? tokens.charcoal.default : tokens.ink[4]), borderRadius: 0, cursor: "pointer", background: showTicket ? tokens.tint.parchment : tokens.neutral[0], color: showTicket ? tokens.ink[0] : tokens.ink[2], touchAction: "manipulation" }}>TICKET</button>
                    <button onClick={() => {
                      setEditingId("new");
                      setTicketId(null);
                      setDraftFromReservation({
                        table_id: r.table_id,
                        data: { ...(r.data || {}), resName: `${d.resName || "Guest"} (copy)` },
                        date: selectedDay,
                      });
                    }}
                      style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "9px 10px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2], touchAction: "manipulation" }}>COPY</button>
                    <button onClick={async () => { if (window.confirm(`Delete reservation for ${d.resName || tLabel}?`)) { await onDelete(r.id); setEditingId(null); setTicketId(null); } }}
                      style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "9px 10px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.red.bg, color: tokens.red.text, touchAction: "manipulation" }}>DEL</button>
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, padding: "12px 16px" }}>
                    <ResvForm
                      initial={r}
                      tables={tables}
                      reservations={reservations}
                      excludeId={r.id}

                      onSave={async (row) => { await onUpsert(row); setEditingId(null); setDraftFromReservation(null); }}
                      onCancel={() => { setEditingId(null); setDraftFromReservation(null); }}
                    />
                  </div>
                )}

                {/* Kitchen ticket preview */}
                {showTicket && ticketVirtualTable && (
                  <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, padding: "12px 16px" }}>
                    <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[3], marginBottom: 8, textTransform: "uppercase" }}>[TICKET PREVIEW]</div>
                    <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, overflow: "hidden", background: tokens.neutral[0] }}>
                      <KitchenTicket table={ticketVirtualTable} menuCourses={menuCourses} upd={updForTicket} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── WEEK OVERVIEW ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />

      {/* Sticky header */}
      <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: tokens.neutral[0], zIndex: 50, gap: 12 }}>
        <button onClick={onExit} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "10px 12px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[1], flexShrink: 0, touchAction: "manipulation" }}>← EXIT</button>
        <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", color: tokens.ink[3], flex: 1, textAlign: "center" }}>[RESERVATIONS]</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "reservations" ? null : "reservations")}
            style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "10px 8px", border: `1px solid ${weeklyPreview === "reservations" ? tokens.charcoal.default : tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: weeklyPreview === "reservations" ? tokens.tint.parchment : tokens.neutral[0], color: weeklyPreview === "reservations" ? tokens.ink[0] : tokens.ink[2], fontWeight: 600, flexShrink: 0, touchAction: "manipulation" }}>OVERVIEW</button>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "allergies" ? null : "allergies")}
            style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase", padding: "10px 8px", border: `1px solid ${weeklyPreview === "allergies" ? tokens.charcoal.default : tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: weeklyPreview === "allergies" ? tokens.tint.parchment : tokens.neutral[0], color: weeklyPreview === "allergies" ? tokens.ink[0] : tokens.ink[2], fontWeight: 600, flexShrink: 0, touchAction: "manipulation" }}>ALLERGIES</button>
          <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn}>◀</button>
          <button onClick={() => setWeekOffset(0)}
            style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3], minWidth: 110, textAlign: "center", background: "none", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "10px 0", cursor: "pointer", touchAction: "manipulation" }}>{fmtRange()}</button>
          <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn}>▶</button>
        </div>
      </div>

      {/* Service date strip */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${tokens.ink[4]}`, display: "flex", alignItems: "center", gap: 10, background: tokens.neutral[0] }}>
        {serviceDate ? (
          <>
            <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.green.text, fontWeight: 600 }}>
              ● SERVICE: {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
            <button onClick={() => { const nd = window.prompt("Change service date (YYYY-MM-DD):", serviceDate); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3], background: "none", border: "none", cursor: "pointer", touchAction: "manipulation", padding: "8px 4px" }}>CHANGE</button>
          </>
        ) : (
          <>
            <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[4] }}>NO ACTIVE SERVICE DATE</span>
            <button onClick={() => { const nd = window.prompt("Set service date (YYYY-MM-DD):", todayStr); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[2], background: "none", border: `1px solid ${tokens.ink[4]}`, cursor: "pointer", borderRadius: 0, padding: "7px 10px", touchAction: "manipulation" }}>SET DATE</button>
          </>
        )}
      </div>

      {/* Weekly overview modal */}
      {weeklyPreview && (() => {
        const isResv = weeklyPreview === "reservations";
        const weeklyData = isResv ? buildWeeklyRows(reservations, weekDays, RESTRICTIONS) : null;
        const weekStart = toDateStr(weekDays[0]);
        const weekEnd = toDateStr(weekDays[6]);
        const allergyWeekResv = !isResv ? reservations
          .filter(r => r.date >= weekStart && r.date <= weekEnd)
          .filter(r => { const d = r.data || {}; return (d.restrictions?.length > 0) || (d.kitchenCourseNotes && Object.keys(d.kitchenCourseNotes).length > 0); })
          .sort((a, b) => a.date.localeCompare(b.date) || (a.data?.resTime || "99").localeCompare(b.data?.resTime || "99"))
          : null;
        const allergyTableCourses = !isResv
          ? menuCourses.filter(c => !c.is_snack).sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
          : null;

        const COL_WIDTHS = ["11%","9%","9%","16%","8%","22%","25%"];
        const COLS = ["DATE","COVER","TIME","NAME","EXP.","INFO","ALLERGIES /\nRESTRICTIONS"];
        const MULTILINE = [false,false,false,false,false,true,true];
        const TALIGN = ["left","center","center","left","center","left","left"];

        const cellVal = (row, ci) => weeklyEdits[`${row.id}-${ci}`] !== undefined ? weeklyEdits[`${row.id}-${ci}`] : (row.cells[ci] ?? "");
        const setCell = (rowId, ci, val) => setWeeklyEdits(p => ({ ...p, [`${rowId}-${ci}`]: val }));
        const cellFw = (row, ci) => (row.type === "date" || row.type === "sub" || ci === 3) ? 700 : 400;

        const cellStyle = (row, ci) => ({
          fontFamily: "'Roboto Mono', monospace",
          fontSize: "8.5pt",
          fontWeight: cellFw(row, ci),
          color: "#000",
          background: "transparent",
          border: "none",
          width: "100%",
          outline: "none",
          resize: "none",
          padding: 0,
          margin: 0,
          textAlign: TALIGN[ci],
          lineHeight: 1.4,
          cursor: "text",
          whiteSpace: "pre-wrap",
          ...(ci === 4 ? { textDecoration: "underline" } : {}),
        });

        const onPrint = () => {
          const printHtml = isResv
            ? weeklyRowsToHTML(weeklyData.rows, weeklyEdits, weeklyData.totalGuests, weeklyData.dateRange)
            : generateAllergyHTMLWithEdits(allergyWeekResv, allergyTableCourses, allergyEdits, RESTRICTIONS);
          const w = window.open("", "_blank", "width=900,height=700");
          if (!w) { alert("Pop-up blocked"); return; }
          w.document.write(printHtml);
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 800);
        };

        const sheetW = isResv ? 794 : 1123;

        return (
          <div style={{
            position: "fixed", inset: 0,
            background: tokens.surface.overlay,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            padding: "16px 12px",
            paddingTop: "calc(16px + env(safe-area-inset-top))",
            paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
            overflow: "hidden",
          }}>
            {/* Top bar — stays pinned; sheet scrolls underneath it */}
            <div style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              width: "100%",
              margin: "0 0 12px",
              flexShrink: 0,
              flexWrap: "wrap",
            }}>
              <button onClick={onPrint} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "8px 16px",
                border: `1px solid ${tokens.neutral[0]}`,
                borderRadius: 0,
                background: tokens.neutral[0],
                color: tokens.ink[0],
                cursor: "pointer", fontWeight: 600,
              }}>PRINT</button>
              {(isResv ? Object.keys(weeklyEdits).length > 0 : Object.keys(allergyEdits).length > 0) && (
                <button onClick={() => isResv ? setWeeklyEdits({}) : setAllergyEdits({})} style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 16px",
                  border: `1px solid rgba(255,255,255,0.3)`,
                  borderRadius: 0,
                  background: "transparent",
                  color: "rgba(255,255,255,0.6)",
                  cursor: "pointer", fontWeight: 400,
                }}>RESET</button>
              )}
              <button onClick={() => setWeeklyPreview(null)} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "8px 16px",
                border: `1px solid rgba(255,255,255,0.4)`,
                borderRadius: 0,
                background: "transparent",
                color: "rgba(255,255,255,0.8)",
                cursor: "pointer", fontWeight: 400,
              }}>CLOSE</button>
            </div>

            {/* A4 sheet — scrollable wrapper so the overlay doesn't clip
                sheets wider than the viewport (reservations 794px, allergies 1123px) */}
            <div style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              WebkitOverflowScrolling: "touch",
              display: "flex",
              flexDirection: "column",
            }}>
            {isResv ? (
              <div style={{
                background: "#fff",
                color: "#000",
                fontFamily: "'Roboto Mono', monospace",
                fontSize: "8.5pt",
                width: 794,
                minHeight: 1123,
                margin: "0 auto",
                padding: "45px 38px",
                boxShadow: `0 0 0 1px ${tokens.neutral[300]}`,
                flexShrink: 0,
              }}>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: "11pt", textAlign: "center", margin: "0 0 2pt", fontWeight: 700, color: "#000" }}>
                  Reservations : {weeklyData.dateRange}
                </div>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: "9pt", textAlign: "center", margin: "0 0 10pt", fontWeight: 700, color: "#000" }}>
                  Guest count : {weeklyData.totalGuests}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <tbody>
                    <tr>
                      {COLS.map((col, i) => (
                        <th key={i} style={{
                          border: "1px solid #aaa",
                          padding: "4pt 5pt",
                          fontFamily: "'Roboto Mono', monospace",
                          fontSize: "8.5pt",
                          fontWeight: 700,
                          textAlign: "center",
                          background: "#fff",
                          color: "#000",
                          wordWrap: "break-word",
                          whiteSpace: "pre-line",
                          verticalAlign: "top",
                        }}>{col}</th>
                      ))}
                    </tr>
                    {weeklyData.rows.map(row => (
                      <tr key={row.id} style={{ background: row.type === "date" ? "#f0f0f0" : "#fff" }}>
                        {row.cells.map((_, ci) => {
                          const cb = weeklyChain.bind(`wk-${row.id}-${ci}`);
                          return (
                            <td key={ci} style={{ border: "1px solid #aaa", padding: "4pt 5pt", verticalAlign: "top" }}>
                              {MULTILINE[ci] ? (
                                <textarea
                                  rows={2}
                                  value={cellVal(row, ci)}
                                  onChange={e => setCell(row.id, ci, e.target.value)}
                                  ref={cb.ref}
                                  onKeyDown={cb.onKeyDown}
                                  style={{ ...cellStyle(row, ci), display: "block" }}
                                />
                              ) : (
                                <input
                                  value={cellVal(row, ci)}
                                  onChange={e => setCell(row.id, ci, e.target.value)}
                                  ref={cb.ref}
                                  onKeyDown={cb.onKeyDown}
                                  style={cellStyle(row, ci)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (() => {
              const isLarge = allergyWeekResv.length > 5;
              const fmtS = ds => { const d = new Date(ds+"T00:00:00"); return `${d.getDate()}.${String(d.getMonth()+1).padStart(2,"0")}.`; };
              const dates = [...new Set(allergyWeekResv.map(r => r.date))].sort();
              const allergyDateRange = dates.length ? `${fmtS(dates[0])}-${fmtS(dates[dates.length-1])}` : "";
              const aCellVal = (k, base) => allergyEdits[k] !== undefined ? allergyEdits[k] : (base || "");
              const setACell = k => e => setAllergyEdits(p => ({ ...p, [k]: e.target.value }));
              const transp = {
                fontFamily: "'Roboto Mono', monospace", fontSize: "8pt", fontWeight: 700,
                background: "transparent", border: "none", outline: "none",
                resize: "none", padding: 0, margin: 0, width: "100%",
                lineHeight: 1.15, color: "inherit",
              };
              const cColSt = { textAlign: "left", padding: "2pt 4pt 2pt 6pt", border: "1px solid #aaa", verticalAlign: "top", ...(isLarge ? {} : { minWidth: 110 }) };
              const rColSt = { textAlign: "center", border: "1px solid #aaa", padding: "2pt 4pt", verticalAlign: "top", ...(isLarge ? {} : { minWidth: 90 }) };
              if (!allergyWeekResv.length) return (
                <div style={{ background: "#fff", width: 1123, minHeight: 400, margin: "0 auto", padding: "60px 40px", boxShadow: `0 0 0 1px ${tokens.neutral[300]}`, fontFamily: "'Roboto Mono', monospace", textAlign: "center", color: "#888", fontSize: "9pt" }}>
                  No restrictions or kitchen edits this week
                </div>
              );
              return (
                <div style={{ background: "#fff", width: 1123, minHeight: 794, margin: "0 auto", padding: "19px", boxShadow: `0 0 0 1px ${tokens.neutral[300]}`, flexShrink: 0, overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: isLarge ? "100%" : "auto", tableLayout: isLarge ? "fixed" : "auto", fontFamily: "'Roboto Mono', monospace", fontSize: "8pt" }}>
                    <tbody>
                      <tr style={{ background: "#3d6b4f" }}>
                        <td style={{ ...cColSt, border: "1px solid #2e5a3e", color: "#fff", fontWeight: 700 }}>
                          <input ref={weeklyChain.bind("al-hdr-date").ref} onKeyDown={weeklyChain.bind("al-hdr-date").onKeyDown} value={aCellVal("hdr-date", allergyDateRange)} onChange={setACell("hdr-date")} style={{ ...transp, color: "#fff" }} />
                        </td>
                        {allergyWeekResv.map(r => (
                          <td key={r.id} style={{ ...rColSt, border: "1px solid #2e5a3e", color: "#fff" }}>
                            <input ref={weeklyChain.bind(`al-name-${r.id}`).ref} onKeyDown={weeklyChain.bind(`al-name-${r.id}`).onKeyDown} value={aCellVal(`name-${r.id}`, r.data?.resName || "—")} onChange={setACell(`name-${r.id}`)} style={{ ...transp, color: "#fff", textAlign: "center" }} />
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ ...cColSt, fontWeight: 700 }}>Date</td>
                        {allergyWeekResv.map(r => (
                          <td key={r.id} style={{ ...rColSt }}>{fmtS(r.date)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ ...cColSt, fontWeight: 700 }}>Allergies/Restrictions</td>
                        {allergyWeekResv.map(r => {
                          const d = r.data || {};
                          const mt = d.menuType === "short" ? "SHORT MENU" : "LONG MENU";
                          const rc = {};
                          (d.restrictions || []).forEach(rs => { rc[rs.note] = (rc[rs.note] || 0) + 1; });
                          const rLines = Object.entries(rc).map(([k, n]) => { const def = RESTRICTIONS.find(x => x.key === k); return `${n}x ${def ? def.label.toLowerCase() : k}`; });
                          const base = `${mt}\n${rLines.join(", ")}`;
                          return (
                            <td key={r.id} style={{ ...rColSt }}>
                              <textarea ref={weeklyChain.bind(`al-restr-${r.id}`).ref} onKeyDown={weeklyChain.bind(`al-restr-${r.id}`).onKeyDown} rows={2} value={aCellVal(`restr-${r.id}`, base)} onChange={setACell(`restr-${r.id}`)} style={{ ...transp, display: "block", textAlign: "center", whiteSpace: "pre-wrap" }} />
                            </td>
                          );
                        })}
                      </tr>
                      {allergyTableCourses.map(course => {
                        const key = course.course_key || "";
                        const isOpt = String(course.course_category || "main") !== "main";
                        const baseName = course.menu?.name || key;
                        const baseSub = course.menu?.sub || "";
                        return (
                          <tr key={key} style={{ background: isOpt ? "#f5f5f5" : "#fff" }}>
                            <td style={{ ...cColSt }}>
                              <span style={{ textTransform: "uppercase", fontWeight: 700, fontSize: "8pt" }}>{baseName}</span>
                              {isOpt && <span style={{ fontWeight: 400, fontSize: "6.5pt", color: "#999" }}> (opt)</span>}
                              {baseSub && <><br /><span style={{ fontWeight: 400, fontSize: "6.5pt", color: "#555" }}>{baseSub}</span></>}
                            </td>
                            {allergyWeekResv.map(r => {
                              const ck = `${key}-${r.id}`;
                              const base = allergyBaseCell(course, r);
                              const val = aCellVal(ck, base);
                              const cb = weeklyChain.bind(`al-${ck}`);
                              return (
                                <td key={r.id} style={{ ...rColSt, background: val ? "#edf7ef" : (isOpt ? "#f5f5f5" : "#fff") }}>
                                  <textarea ref={cb.ref} onKeyDown={cb.onKeyDown} rows={1} value={val} onChange={setACell(ck)} style={{ ...transp, display: "block", fontWeight: val ? 700 : 400, whiteSpace: "pre-wrap" }} />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            </div>
          </div>
        );
      })()}

      {/* Week grid — big tappable day tiles */}
      <div style={{ padding: "16px 16px 60px", maxWidth: 600, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {weekDays.map(day => {
            const dateStr    = toDateStr(day);
            const dayResv    = resvForDate(dateStr);
            const isToday      = dateStr === todayStr;
            const isServiceDay = dateStr === serviceDate;
            const totalGuests  = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);

            return (
              <button key={dateStr} onClick={() => setSelectedDay(dateStr)}
                style={{
                  fontFamily: FONT, textAlign: "left", cursor: "pointer",
                  borderTop:    `1px solid ${isServiceDay ? tokens.green.border : isToday ? tokens.ink[3] : tokens.ink[4]}`,
                  borderRight:  `1px solid ${isServiceDay ? tokens.green.border : isToday ? tokens.ink[3] : tokens.ink[4]}`,
                  borderBottom: `1px solid ${isServiceDay ? tokens.green.border : isToday ? tokens.ink[3] : tokens.ink[4]}`,
                  borderLeft:   `3px solid ${isServiceDay ? tokens.green.border : isToday ? tokens.ink[3] : tokens.ink[4]}`,
                  borderRadius: 0, padding: "14px 16px",
                  background: isServiceDay ? tokens.green.bg : tokens.neutral[0],
                  display: "flex", alignItems: "center", gap: 14,
                  transition: "all 0.1s",
                }}>
                {/* Day label */}
                <div style={{ minWidth: 100 }}>
                  <div style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: isServiceDay ? tokens.green.text : isToday ? tokens.ink[0] : tokens.ink[3] }}>
                    {day.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase", color: isServiceDay ? tokens.green.border : isToday ? tokens.ink[2] : tokens.ink[3], marginTop: 2 }}>
                    {day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}
                  </div>
                </div>

                {/* Badges */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {isServiceDay && <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.green.text, fontWeight: 600 }}>● SERVICE</span>}
                  {isToday && !isServiceDay && <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3] }}>TODAY</span>}
                </div>

                {/* Count */}
                <div style={{ textAlign: "right" }}>
                  {dayResv.length > 0 ? (
                    <>
                      <div style={{ fontFamily: FONT, fontSize: "16px", fontWeight: 700, color: tokens.ink[0], lineHeight: 1 }}>{dayResv.length}</div>
                      <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3], marginTop: 2 }}>{totalGuests} guests</div>
                    </>
                  ) : (
                    <div style={{ fontFamily: FONT, fontSize: "10px", color: tokens.ink[4], letterSpacing: "0.10em" }}>—</div>
                  )}
                </div>

                {/* Arrow */}
                <span style={{ fontFamily: FONT, fontSize: "14px", color: tokens.ink[4] }}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
