import { useEffect, useMemo, useState } from "react";
import { generateWeeklyReservationsHTML, generateWeeklyAllergyHTML } from "../../utils/weeklyPrintGenerator.js";
import { blankTable, makeSeats } from "../../utils/tableHelpers.js";
import { RESTRICTIONS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { UI } from "../../styles/uiChrome.js";
import { baseInput, fieldLabel as fieldLabelMixin, circleButton } from "../../styles/mixins.js";
import ServiceDatePicker from "./ServiceDatePicker.jsx";
import ResvForm from "./ResvForm.jsx";
import { KitchenTicket } from "../kitchen/KitchenBoard.jsx";

const FONT = tokens.font;
const R = tokens.radius;
const baseInp = { ...baseInput };
const fieldLabel = { ...fieldLabelMixin };
const circBtnSm = { ...circleButton };
const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;
const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const SITTING_TIMES = String(import.meta.env.VITE_DEFAULT_SITTING_TIMES || "18:00,18:30,19:00,19:15").split(",").map(s => s.trim()).filter(Boolean);
const ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23").split(",").map(s => s.trim()).filter(Boolean);
const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: #1a1a1a; }
      input, textarea, select { font-size: ${MOBILE_SAFE_INPUT_SIZE}px; }
      button, a, label { touch-action: manipulation; }
    `}</style>
  );
}

export default function ReservationManager({ reservations, menuCourses, tables, onUpsert, onDelete, onUpdReservation, onExit, serviceDate, onSetServiceDate }) {
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);   // "YYYY-MM-DD" or null (week view)
  const [editingId,   setEditingId]   = useState(null);   // reservation id being edited, or "new"
  const [ticketId,    setTicketId]    = useState(null);    // reservation id showing kitchen preview
  const [weeklyPreview, setWeeklyPreview] = useState(null); // "reservations" | "allergies" | null
  const [draftFromReservation, setDraftFromReservation] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      if (weeklyPreview) {
        setWeeklyPreview(null);
        return;
      }
      if (selectedDay) {
        if (ticketId) {
          setTicketId(null);
          return;
        }
        if (editingId) {
          setEditingId(null);
          setDraftFromReservation(null);
          return;
        }
        setSelectedDay(null);
        setEditingId(null);
        setTicketId(null);
        setDraftFromReservation(null);
        return;
      }
      onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [weeklyPreview, selectedDay, ticketId, editingId, onExit]);

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

  const navBtn = { fontFamily: FONT, fontSize: 12, padding: "6px 10px", border: `1px solid ${UI.border}`, borderRadius: R, cursor: "pointer", background: UI.surface, color: "#555" };

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
      <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
        <GlobalStyle />

        {/* Sticky header */}
        <div style={{ borderBottom: "1px solid #f0f0f0", padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#fff", zIndex: 50, gap: 12 }}>
          <button onClick={() => { setSelectedDay(null); setEditingId(null); setTicketId(null); setDraftFromReservation(null); }}
            style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: `1px solid ${UI.border}`, borderRadius: R, cursor: "pointer", background: UI.surface, color: UI.ink, flexShrink: 0 }}>← WEEK</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: isService ? "#2f7a45" : UI.ink, fontWeight: 600 }}>{dayLabel}</div>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "#aaa", marginTop: 2 }}>
              {dayResv.length} reservation{dayResv.length !== 1 ? "s" : ""} · {totalGuests} guests
              {isService && <span style={{ color: "#2f7a45", marginLeft: 6 }}>● ACTIVE SERVICE</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => {
              const next = editingId === "new" ? null : "new";
              setEditingId(next);
              setDraftFromReservation(null);
            }}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: `1px solid ${editingId === "new" ? UI.line : UI.border}`, borderRadius: R, cursor: "pointer", background: editingId === "new" ? UI.selectedBg : UI.surface, color: UI.ink, fontWeight: 600 }}>+ ADD</button>
          </div>
        </div>

        <div style={{ padding: "16px 16px 60px", maxWidth: 700, margin: "0 auto" }}>

          {/* New reservation form */}
          {editingId === "new" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 3, color: "#999", marginBottom: 6, textTransform: "uppercase" }}>New Reservation</div>
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
            <div style={{ textAlign: "center", padding: "60px 0", color: "#ccc" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>◫</div>
              <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2 }}>NO RESERVATIONS</div>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, marginTop: 6, color: "#ddd" }}>Tap + ADD or TEMPLATE to create one</div>
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
                border: `1px solid ${UI.border}`, borderRadius: R, marginBottom: 10,
                background: "#fff", overflow: "hidden",
              }}>
                {/* Card header — always visible */}
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Table badge */}
                  <div style={{ background: UI.surface2, color: UI.ink, fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "8px 12px", border: `1px solid ${UI.line}`, borderRadius: R, minWidth: 48, textAlign: "center" }}>{tLabel}</div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT, fontSize: 13, color: UI.ink, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.resName || "—"}
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {d.resTime && <span>{d.resTime}</span>}
                      <span>{d.guests || 2} guests</span>
                      {d.menuType && <span style={{ color: UI.ink, textTransform: "uppercase", letterSpacing: 1 }}>{d.menuType}</span>}
                      {d.lang === "si" && <span style={{ color: "#6080c0" }}>SLO</span>}
                      {d.birthday && <span>🎂{d.cakeNote ? ` ${d.cakeNote}` : ""}</span>}
                      {d.guestType === "hotel" && d.room && <span style={{ color: "#a07040" }}>Room {d.room}</span>}
                    </div>
                    {d.restrictions?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {d.restrictions.map((rs, i) => {
                          const def = RESTRICTIONS.find(x => x.key === rs.note);
                          return <span key={i} style={{ fontFamily: FONT, fontSize: 9, color: "#b04040", background: "#fef0f0", border: "1px solid #f0d0d0", borderRadius: 2, padding: "2px 6px" }}>{def ? `${def.emoji} ${def.label}` : rs.note}</span>;
                        })}
                      </div>
                    )}
                    {d.notes && <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.notes}</div>}
                  </div>
                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => { setEditingId(isEditing ? null : r.id); if (!isEditing) setTicketId(null); }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: `1px solid ${isEditing ? UI.line : UI.border}`, borderRadius: R, cursor: "pointer", background: isEditing ? UI.selectedBg : UI.surface, color: UI.ink }}>EDIT</button>
                    <button onClick={() => { setTicketId(showTicket ? null : r.id); if (!showTicket) setEditingId(null); }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: `1px solid ${showTicket ? UI.line : UI.border}`, borderRadius: R, cursor: "pointer", background: showTicket ? UI.selectedBg : UI.surface, color: UI.ink }}>TICKET</button>
                    <button onClick={() => {
                      setEditingId("new");
                      setTicketId(null);
                      setDraftFromReservation({
                        table_id: r.table_id,
                        data: { ...(r.data || {}), resName: `${d.resName || "Guest"} (copy)` },
                        date: selectedDay,
                      });
                    }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: `1px solid ${UI.border}`, borderRadius: R, cursor: "pointer", background: UI.surface, color: "#666" }}>COPY</button>
                    <button onClick={async () => { if (window.confirm(`Delete reservation for ${d.resName || tLabel}?`)) { await onDelete(r.id); setEditingId(null); setTicketId(null); } }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: "1px solid #f0c0c0", borderRadius: R, cursor: "pointer", background: "#fff8f8", color: "#c04040" }}>DEL</button>
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px" }}>
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
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px" }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 3, color: "#bbb", marginBottom: 8, textTransform: "uppercase" }}>Kitchen Ticket Preview</div>
                    <div style={{ border: `1px solid ${UI.borderLight}`, borderRadius: R, overflow: "hidden", background: UI.surface }}>
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
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />

      {/* Sticky header */}
      <div style={{ borderBottom: "1px solid #f0f0f0", padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#fff", zIndex: 50, gap: 12 }}>
        <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: `1px solid ${UI.border}`, borderRadius: R, cursor: "pointer", background: UI.surface, color: UI.ink, flexShrink: 0 }}>← EXIT</button>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#999", flex: 1, textAlign: "center" }}>RESERVATIONS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "reservations" ? null : "reservations")}
            style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${weeklyPreview === "reservations" ? UI.line : UI.border}`, borderRadius: R, cursor: "pointer", background: weeklyPreview === "reservations" ? UI.selectedBg : UI.surface, color: UI.ink, fontWeight: 600, flexShrink: 0 }}>OVERVIEW</button>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "allergies" ? null : "allergies")}
            style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${weeklyPreview === "allergies" ? UI.line : UI.border}`, borderRadius: R, cursor: "pointer", background: weeklyPreview === "allergies" ? UI.selectedBg : UI.surface, color: UI.ink, fontWeight: 600, flexShrink: 0 }}>ALLERGIES</button>
          <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn}>◀</button>
          <button onClick={() => setWeekOffset(0)}
            style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#888", minWidth: 110, textAlign: "center", background: "none", border: `1px solid ${UI.borderLight}`, borderRadius: R, padding: "5px 0", cursor: "pointer" }}>{fmtRange()}</button>
          <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn}>▶</button>
        </div>
      </div>

      {/* Service date strip */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
        {serviceDate ? (
          <>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#2f7a45", fontWeight: 600 }}>
              ● SERVICE: {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
            <button onClick={() => { const nd = window.prompt("Change service date (YYYY-MM-DD):", serviceDate); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", background: "none", border: "none", cursor: "pointer" }}>change</button>
          </>
        ) : (
          <>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#ccc" }}>NO ACTIVE SERVICE DATE</span>
            <button onClick={() => { const nd = window.prompt("Set service date (YYYY-MM-DD):", todayStr); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: 8, color: "#888", background: "none", border: "1px solid #e0e0e0", cursor: "pointer", borderRadius: 2, padding: "2px 8px" }}>SET DATE</button>
          </>
        )}
      </div>

      {/* Weekly preview panel */}
      {weeklyPreview && (() => {
        const html = weeklyPreview === "reservations"
          ? generateWeeklyReservationsHTML(reservations, weekDays, RESTRICTIONS)
          : generateWeeklyAllergyHTML(reservations, menuCourses, weekDays, RESTRICTIONS);
        const isLandscape = weeklyPreview === "allergies";
        const a4W = isLandscape ? 1123 : 794;
        const a4H = isLandscape ? 794 : 1123;
        const containerW = Math.min(window.innerWidth - 32, 700);
        const scale = containerW / a4W;
        return (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>
                {weeklyPreview === "reservations" ? "Weekly Overview" : "Weekly Allergies"} Preview
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => {
                  const w = window.open("", "_blank", "width=900,height=700");
                  if (!w) { alert("Pop-up blocked"); return; }
                  w.document.write(html); w.document.close(); w.focus();
                  setTimeout(() => w.print(), 800);
                }}
                  style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, padding: "5px 12px", border: `1px solid ${UI.line}`, borderRadius: R, cursor: "pointer", background: UI.surface2, color: UI.ink, fontWeight: 600 }}>PRINT</button>
                <button onClick={() => setWeeklyPreview(null)}
                  style={{ fontFamily: FONT, fontSize: 10, background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: "0 4px" }}>×</button>
              </div>
            </div>
            <div style={{ width: containerW, height: Math.round(a4H * scale), overflow: "hidden", border: "1px solid #e0e0e0", borderRadius: 4, background: "#fff" }}>
              <iframe srcDoc={html} title="weekly preview"
                style={{ width: a4W, height: a4H, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
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
                  border: `1.5px solid ${isServiceDay ? "#b0d8b0" : isToday ? "#d0d0d0" : "#efefef"}`,
                  borderRadius: 6, padding: "14px 16px",
                  background: isServiceDay ? "#f4fbf4" : "#fff",
                  display: "flex", alignItems: "center", gap: 14,
                  transition: "all 0.1s",
                }}>
                {/* Day label */}
                <div style={{ minWidth: 100 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, color: isServiceDay ? "#2f7a45" : isToday ? "#1a1a1a" : "#888" }}>
                    {day.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: 1, color: isServiceDay ? "#5aaa6a" : isToday ? "#666" : "#bbb", marginTop: 2 }}>
                    {day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}
                  </div>
                </div>

                {/* Badges */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {isServiceDay && <span style={{ fontSize: 8, letterSpacing: 1, color: "#2f7a45", fontWeight: 600 }}>● SERVICE</span>}
                  {isToday && !isServiceDay && <span style={{ fontSize: 8, letterSpacing: 1, color: "#bbb" }}>TODAY</span>}
                </div>

                {/* Count */}
                <div style={{ textAlign: "right" }}>
                  {dayResv.length > 0 ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", lineHeight: 1 }}>{dayResv.length}</div>
                      <div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1, marginTop: 2 }}>{totalGuests} guests</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 1 }}>—</div>
                  )}
                </div>

                {/* Arrow */}
                <span style={{ fontSize: 14, color: "#ccc" }}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
