import { useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const { ink, rule, neutral, green, charcoal, tint } = tokens;

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export default function ServiceDatePicker({ defaultDate, onConfirm, onCancel, reservations = [], appName = "MILKA" }) {
  const todayStr = toLocalDateISO();
  const [selected, setSelected] = useState(defaultDate || todayStr);
  const [weekOffset, setWeekOffset] = useState(0);

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
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
        zIndex: 200,
        padding: 16,
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: neutral[0],
          borderRadius: 0,
          overflow: "hidden",
          border: `${rule.hairline} solid ${ink[4]}`,
        }}
      >
        {/* Header */}
        <div style={{ background: neutral[0], padding: "20px 20px 16px", textAlign: "center", borderBottom: `${rule.hairline} solid ${ink[4]}` }}>
          <div style={{
            fontFamily: FONT, fontSize: "8px", letterSpacing: "0.22em",
            textTransform: "uppercase", color: ink[3], marginBottom: 6,
          }}>{appName}</div>
          <div style={{
            fontFamily: FONT, fontSize: "11px", letterSpacing: "0.18em",
            textTransform: "uppercase", color: ink[0], fontWeight: 700,
          }}>[SELECT SERVICE DATE]</div>
        </div>

        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            style={{ fontFamily: FONT, fontSize: "16px", border: "none", background: "none", cursor: "pointer", color: ink[2], padding: "4px 10px", lineHeight: 1 }}
          >‹</button>
          <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: ink[3], fontWeight: 600 }}>{monthLabel}</span>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            style={{ fontFamily: FONT, fontSize: "16px", border: "none", background: "none", cursor: "pointer", color: ink[2], padding: "4px 10px", lineHeight: 1 }}
          >›</button>
        </div>

        {/* Day grid */}
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
                  border: `${rule.hairline} solid ${isSel ? charcoal.default : isToday ? green.border : ink[4]}`,
                  borderRadius: 0,
                  cursor: "pointer",
                  padding: "10px 0",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.12s",
                  background: isSel ? tint.parchment : isToday ? green.bg : neutral[50],
                  opacity: isPast && !isSel ? 0.45 : 1,
                }}
              >
                <span style={{
                  fontFamily: FONT, fontSize: "7px", letterSpacing: "0.10em",
                  color: isSel ? ink[0] : ink[3], fontWeight: 600,
                }}>{DAY_LABELS[i]}</span>
                <span style={{
                  fontFamily: FONT, fontSize: "16px", fontWeight: 700,
                  color: isSel ? ink[0] : isToday ? green.text : ink[0], lineHeight: 1,
                }}>{dayNum}</span>
                {isToday && <span style={{ width: 4, height: 4, borderRadius: 0, background: isSel ? charcoal.default : green.text }} />}
                {dayResv.length > 0 && <span style={{ width: 4, height: 4, borderRadius: 0, background: isSel ? charcoal.default : ink[4], marginTop: 2 }} />}
              </button>
            );
          })}
        </div>

        {/* Selected date summary */}
        {selected &&
          (() => {
            const selResv = reservations.filter((r) => r.date === selected);
            const selGuests = selResv.reduce((a, r) => a + (r.data?.guests || 2), 0);
            return (
              <div style={{ textAlign: "center", paddingBottom: 6 }}>
                <span style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
                  textTransform: "uppercase", color: green.text, fontWeight: 600,
                }}>
                  {new Date(selected + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
                </span>
                {selResv.length > 0 && (
                  <div style={{
                    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em",
                    textTransform: "uppercase", color: green.text, fontWeight: 600, marginTop: 4,
                  }}>
                    {selGuests} PAX · {selResv.length} {selResv.length === 1 ? "TABLE" : "TABLES"}
                  </div>
                )}
              </div>
            );
          })()}

        {/* Footer actions */}
        <div style={{ display: "flex", gap: 0, borderTop: `${rule.hairline} solid ${ink[4]}`, marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
              textTransform: "uppercase", padding: "16px 0", flex: 1,
              border: "none", borderRight: `${rule.hairline} solid ${ink[4]}`,
              cursor: "pointer", background: neutral[0], color: ink[3], fontWeight: 400,
            }}
          >CANCEL</button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
              textTransform: "uppercase", padding: "16px 0", flex: 2,
              border: "none", cursor: selected ? "pointer" : "not-allowed",
              background: selected ? charcoal.default : neutral[50],
              color: selected ? neutral[0] : ink[4], fontWeight: 600, opacity: 1,
            }}
          >START SERVICE ›</button>
        </div>
      </div>
    </div>
  );
}
