import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { UI } from "../../styles/uiChrome.js";

const FONT = tokens.font;
const R = tokens.radius;

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export default function ServiceDatePicker({ defaultDate, onConfirm, onCancel, reservations = [], appName = "MILKA" }) {
  const todayStr = toLocalDateISO();
  const [selected, setSelected] = useState(defaultDate || todayStr);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const weekDays = useMemo(() => {
    const today = new Date();
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dow + 6) % 7) + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return toLocalDateISO(d);
    });
  }, [weekOffset]);

  const monthLabel = useMemo(() => {
    const d = new Date(weekDays[0] + "T00:00:00");
    const d2 = new Date(weekDays[6] + "T00:00:00");
    const m1 = d.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
    const m2 = d2.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
    const y = d2.getFullYear();
    return m1 === m2 ? `${m1} ${y}` : `${m1} / ${m2} ${y}`;
  }, [weekDays]);

  const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: UI.surface,
          borderRadius: R,
          border: `1px solid ${UI.border}`,
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ background: UI.surface2, borderBottom: `1px solid ${UI.border}`, padding: "18px 20px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: 4, color: UI.textMuted, marginBottom: 4 }}>{appName}</div>
          <div style={{ fontSize: 13, letterSpacing: 3, color: UI.ink, fontWeight: 700 }}>SELECT SERVICE DATE</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            style={{ fontFamily: FONT, fontSize: 16, border: "none", background: "none", cursor: "pointer", color: "#555", padding: "4px 10px", lineHeight: 1 }}
          >
            ‹
          </button>
          <span style={{ fontSize: 9, letterSpacing: 3, color: "#888", fontWeight: 600 }}>{monthLabel}</span>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            style={{ fontFamily: FONT, fontSize: 16, border: "none", background: "none", cursor: "pointer", color: "#555", padding: "4px 10px", lineHeight: 1 }}
          >
            ›
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: "0 14px 20px" }}>
          {weekDays.map((dateStr, i) => {
            const d = new Date(dateStr + "T00:00:00");
            const dayNum = d.getDate();
            const isToday = dateStr === todayStr;
            const isSel = dateStr === selected;
            const isPast = dateStr < todayStr;
            const dayResv = reservations.filter((r) => r.date === dateStr);
            return (
              <button
                key={dateStr}
                onClick={() => setSelected(dateStr)}
                style={{
                  fontFamily: FONT,
                  border: isSel ? `2px solid ${UI.line}` : "1px solid #eaeaea",
                  borderRadius: R,
                  cursor: "pointer",
                  padding: "10px 0",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.12s",
                  background: isSel ? UI.selectedBg : isToday ? "#f0f8f4" : UI.surface3,
                  outline: "none",
                  opacity: isPast && !isSel ? 0.45 : 1,
                }}
              >
                <span style={{ fontSize: 8, letterSpacing: 1, color: isSel ? UI.textMuted : "#aaa", fontWeight: 600 }}>{DAY_LABELS[i]}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: isSel ? UI.ink : isToday ? "#2f7a45" : UI.ink, lineHeight: 1 }}>{dayNum}</span>
                {isToday && <span style={{ width: 4, height: 4, borderRadius: R, background: isSel ? "#3a8a5a" : "#3a8a5a" }} />}
                {dayResv.length > 0 && <span style={{ width: 4, height: 4, borderRadius: R, background: isSel ? "#888" : "#bbb", marginTop: 2 }} />}
              </button>
            );
          })}
        </div>

        {selected &&
          (() => {
            const selResv = reservations.filter((r) => r.date === selected);
            const selGuests = selResv.reduce((a, r) => a + (r.data?.guests || 2), 0);
            return (
              <div style={{ textAlign: "center", paddingBottom: 6 }}>
                <span style={{ fontSize: 10, letterSpacing: 2, color: "#3a8a5a", fontWeight: 600 }}>
                  {new Date(selected + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
                </span>
                {selResv.length > 0 && (
                  <div style={{ fontSize: 9, letterSpacing: 1, color: "#3a8a5a", fontWeight: 600, marginTop: 4 }}>
                    {selGuests} PAX · {selResv.length} {selResv.length === 1 ? "TABLE" : "TABLES"}
                  </div>
                )}
              </div>
            );
          })()}

        <div style={{ display: "flex", gap: 0, borderTop: "1px solid #f0f0f0", marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "16px 0", flex: 1, border: "none", borderRight: "1px solid #f0f0f0", cursor: "pointer", background: "#fff", color: "#888", fontWeight: 500 }}
          >
            CANCEL
          </button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "16px 0", flex: 2, border: "none", borderLeft: `1px solid ${UI.borderLight}`, cursor: selected ? "pointer" : "not-allowed", background: selected ? UI.surface2 : UI.surface3, color: selected ? UI.ink : "#aaa", fontWeight: 700, opacity: 1 }}
          >
            START SERVICE ›
          </button>
        </div>
      </div>
    </div>
  );
}
