import { useMemo } from "react";
import { tokens } from "../../../styles/tokens.js";
import { generateSlots, resolveServicesForDate, suggestTables } from "../../../domain/reservations/availability.js";
import {
  DOW_SHORT,
  FONT,
  MONTHS_LONG,
  coversOf,
  darkButton,
  dayLabel,
  isActiveBooking,
  mondayOf,
  quietButton,
  sectionLabel,
  shiftISO,
  todayISO,
} from "./shared.js";

const RULE_DOT = {
  closed: { fill: tokens.ink[4], label: "Closed" },
  private_event: { fill: tokens.signal.active, label: "Private event" },
  capacity_override: { outline: tokens.signal.alert, label: "Capacity override" },
  service_override: { outline: tokens.charcoal.default, label: "Service override" },
};

/**
 * Planning across future services.
 *
 * Covers and remaining capacity per day, with closures, private events,
 * capacity overrides and service overrides carrying a dot and a written note.
 * Lunch shows only where a weekday actually enables it — the calendar asks the
 * same engine the guest page does, so a day that reads open here is bookable
 * there.
 *
 * Date rules are owned by Admin → Calendar & Closures; this view reports them.
 */
export default function CalendarTab({
  selectedDate,
  onSelectDate,
  month,
  onMonth,
  bookings,
  weeklyServices,
  calendarRules,
  config,
  onOpenDay,
  onNewBooking,
  isMobile,
}) {
  const today = todayISO();

  const statsFor = useMemo(() => {
    const byDate = new Map();
    bookings.forEach((booking) => {
      if (!isActiveBooking(booking)) return;
      byDate.set(booking.date, [...(byDate.get(booking.date) || []), booking]);
    });

    return (date) => {
      const rows = byDate.get(date) || [];
      const dayRules = calendarRules.filter((rule) => rule.date === date);
      const closed = dayRules.find((rule) => rule.kind === "closed");
      const privateEvent = dayRules.find((rule) => rule.kind === "private_event");
      const capacity = dayRules.find((rule) => rule.kind === "capacity_override");
      const overrides = dayRules.filter((rule) => rule.kind === "service_override");
      const services = resolveServicesForDate(date, weeklyServices, calendarRules);
      const slots = services.flatMap((service) =>
        generateSlots(service.first, service.last, service.interval).map((time) => ({ time, service: service.service })),
      );
      const open = slots.filter((slot) => suggestTables({ date, time: slot.time, pax: 2, bookings: rows, config })).length;
      const lunch = coversOf(rows.filter((booking) => booking.service === "lunch"));
      return {
        rows,
        covers: coversOf(rows),
        pending: rows.filter((booking) => booking.status === "pending").length,
        lunch,
        dinner: coversOf(rows) - lunch,
        closed,
        privateEvent,
        capacity,
        overrides,
        services,
        slots,
        open,
      };
    };
  }, [bookings, calendarRules, weeklyServices, config]);

  const weekStart = mondayOf(selectedDate);
  const week = Array.from({ length: 7 }, (_, index) => shiftISO(weekStart, index));

  const gridStart = mondayOf(`${month}-01`);
  const cells = Array.from({ length: 42 }, (_, index) => shiftISO(gridStart, index));

  const selected = statsFor(selectedDate);

  const shiftMonth = (delta) => {
    const base = new Date(`${month}-15T12:00:00`);
    base.setMonth(base.getMonth() + delta);
    onMonth(`${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", gap: isMobile ? 14 : 0 }}>
      <div style={{ flex: 1, minWidth: isMobile ? "100%" : 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" style={quietButton} onClick={() => onSelectDate(shiftISO(selectedDate, -7))}>
            ◀ Week
          </button>
          <button type="button" style={quietButton} onClick={() => onSelectDate(today)}>
            Today
          </button>
          <button type="button" style={quietButton} onClick={() => onSelectDate(shiftISO(selectedDate, 7))}>
            Week ▶
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(7,1fr)", gap: 5 }}>
          {week.map((date) => {
            const stats = statsFor(date);
            const isSelected = date === selectedDate;
            const state = stats.closed
              ? "Closed"
              : stats.privateEvent
                ? "Private event"
                : stats.slots.length === 0
                  ? "No service"
                  : stats.open === 0
                    ? "Fully booked"
                    : `${stats.open}/${stats.slots.length} seatings open`;
            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelectDate(date)}
                style={{
                  background: stats.closed || stats.privateEvent ? tokens.neutral[50] : tokens.neutral[0],
                  border: `1px solid ${isSelected ? tokens.charcoal.default : tokens.ink[5]}`,
                  borderTop: `2px solid ${date === today ? tokens.signal.active : isSelected ? tokens.charcoal.default : tokens.ink[5]}`,
                  padding: "10px 12px",
                  minHeight: 44,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: FONT,
                }}
              >
                <div style={{ fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3] }}>
                  {DOW_SHORT[new Date(`${date}T12:00:00`).getDay()]} {Number(date.slice(8))}
                  {date === today ? " · TODAY" : ""}
                </div>
                <div style={{ fontSize: 22, fontWeight: 500, color: tokens.ink[0], marginTop: 6, lineHeight: 1 }}>
                  {stats.closed || stats.privateEvent ? "—" : stats.covers}
                </div>
                <div style={{ fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], marginTop: 6 }}>
                  {stats.rows.length} resv · {stats.pending} pend
                </div>
                <div style={{ fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], marginTop: 2 }}>
                  L {stats.lunch} · D {stats.dinner}
                  {stats.capacity ? ` · cap ${stats.capacity.capacity}` : ""}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.10em",
                    fontWeight: 600,
                    marginTop: 6,
                    textTransform: "uppercase",
                    color: stats.privateEvent
                      ? tokens.signal.active
                      : stats.closed
                        ? tokens.ink[3]
                        : stats.open === 0
                          ? tokens.signal.warn
                          : tokens.green.text,
                  }}
                >
                  {state}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
            <span style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 600, color: tokens.ink[0] }}>
              {MONTHS_LONG[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
            </span>
            <span style={{ display: "flex", gap: 5 }}>
              <button type="button" style={quietButton} onClick={() => shiftMonth(-1)}>
                ◀
              </button>
              <button type="button" style={quietButton} onClick={() => shiftMonth(1)}>
                ▶
              </button>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: `1px solid ${tokens.ink[5]}` }}>
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((label) => (
              <span key={label} style={{ fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], padding: "6px 8px" }}>
                {label}
              </span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
            {cells.map((date) => {
              const inMonth = date.slice(0, 7) === month;
              const stats = statsFor(date);
              const isSelected = date === selectedDate;
              const dot = stats.privateEvent
                ? RULE_DOT.private_event
                : stats.closed
                  ? RULE_DOT.closed
                  : stats.capacity
                    ? RULE_DOT.capacity_override
                    : stats.overrides.length
                      ? RULE_DOT.service_override
                      : null;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelectDate(date)}
                  style={{
                    minHeight: 46,
                    padding: "6px 8px",
                    background: inMonth ? (isSelected ? tokens.tint.parchment : tokens.neutral[0]) : tokens.neutral[50],
                    border: `1px solid ${isSelected ? tokens.charcoal.default : tokens.neutral[100]}`,
                    borderLeft: date === today ? `2px solid ${tokens.signal.active}` : `1px solid ${isSelected ? tokens.charcoal.default : tokens.neutral[100]}`,
                    color: inMonth ? tokens.ink[1] : tokens.ink[4],
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: FONT,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{Number(date.slice(8))}</span>
                    {dot && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          display: "inline-block",
                          background: dot.fill || tokens.neutral[0],
                          border: dot.outline ? `1px solid ${dot.outline}` : "none",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 4 }}>
                    {!inMonth || stats.closed || stats.privateEvent ? "" : stats.covers || ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], marginTop: 8, lineHeight: 1.8 }}>
          ■ grey closed · ■ gold private event · □ red capacity override · □ dark service override · gold left rule = today
        </div>
      </div>

      <div
        style={{
          width: isMobile ? "100%" : 340,
          flex: isMobile ? "1 1 100%" : "0 1 340px",
          borderLeft: isMobile ? "none" : `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={sectionLabel}>[Selected day]</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: tokens.ink[0] }}>
              {dayLabel(selectedDate)} {selectedDate.slice(0, 4)}
            </span>
            {selected.privateEvent && (
              <span style={{ fontSize: 8, letterSpacing: "0.10em", fontWeight: 600, color: tokens.signal.active }}>
                [PRIVATE · {String(selected.privateEvent.label || "event").toUpperCase()}]
              </span>
            )}
            {selected.closed && (
              <span style={{ fontSize: 8, letterSpacing: "0.10em", fontWeight: 600, color: tokens.ink[3] }}>[CLOSED]</span>
            )}
            {selected.capacity && (
              <span style={{ fontSize: 8, letterSpacing: "0.10em", fontWeight: 600, color: tokens.signal.alert }}>
                [CAPACITY {selected.capacity.capacity}]
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: tokens.ink[5], border: `1px solid ${tokens.ink[5]}`, marginTop: 10 }}>
            {[
              { k: "Covers", v: String(selected.covers) },
              { k: "Reservations", v: String(selected.rows.length) },
              { k: "Pending", v: String(selected.pending) },
              { k: "Open seatings", v: selected.closed || selected.privateEvent ? "0" : `${selected.open}/${selected.slots.length}` },
              { k: "Lunch / dinner", v: `${selected.lunch} / ${selected.dinner}` },
              { k: "Services", v: selected.services.map((service) => service.service).join(", ") || "—" },
            ].map((stat) => (
              <div key={stat.k} style={{ background: tokens.neutral[0], padding: "7px 9px" }}>
                <div style={{ fontSize: 7, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase" }}>{stat.k}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.ink[0], marginTop: 2 }}>{stat.v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
            <button type="button" style={{ ...darkButton, flex: 1 }} onClick={() => onOpenDay(selectedDate)}>
              Open in Day Book →
            </button>
            <button type="button" style={{ ...quietButton, flex: 1, fontWeight: 600 }} onClick={() => onNewBooking(selectedDate)}>
              [+] Booking
            </button>
          </div>
        </div>

        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={sectionLabel}>[Seatings — tap to book]</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 8 }}>
            {selected.slots.map((slot) => {
              const slotCovers = coversOf(
                selected.rows.filter((booking) => booking.service === slot.service && booking.time === slot.time),
              );
              const fits = suggestTables({ date: selectedDate, time: slot.time, pax: 2, bookings: selected.rows, config });
              return (
                <button
                  key={`${slot.service}-${slot.time}`}
                  type="button"
                  disabled={!fits}
                  onClick={() => onNewBooking(selectedDate, slot.service, slot.time)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    minHeight: 44,
                    border: `1px solid ${fits ? tokens.ink[4] : tokens.ink[5]}`,
                    background: fits ? tokens.neutral[0] : tokens.neutral[50],
                    color: fits ? tokens.ink[1] : tokens.neutral[400],
                    cursor: fits ? "pointer" : "not-allowed",
                    fontFamily: FONT,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 600, display: "block" }}>
                    {slot.time} · {slot.service.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, letterSpacing: "0.04em", display: "block", marginTop: 2 }}>
                    {slotCovers}/{config.pacing.coversPerSlot} covers{fits ? "" : " · full"}
                  </span>
                </button>
              );
            })}
            {selected.slots.length === 0 && (
              <div style={{ fontSize: 9, letterSpacing: "0.06em", color: tokens.ink[3], padding: "8px 0", gridColumn: "1 / -1" }}>
                No service on this date.
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <span style={sectionLabel}>[Date rules]</span>
          <div style={{ fontSize: 9, color: tokens.ink[2], lineHeight: 1.9, marginTop: 8 }}>
            {selected.closed && <div>Closed — {selected.closed.label || "closed by staff"}</div>}
            {selected.privateEvent && <div>Private event — {selected.privateEvent.label || "private"}</div>}
            {selected.capacity && <div>Day capacity capped at {selected.capacity.capacity} covers</div>}
            {selected.overrides.map((rule, index) => (
              <div key={index}>
                {rule.service} override — {rule.mode === "off" ? "not served this date" : rule.mode === "on" ? "added for this date" : "hours changed"}
                {rule.onlineOff ? " · online paused" : ""}
              </div>
            ))}
            {!selected.closed && !selected.privateEvent && !selected.capacity && selected.overrides.length === 0 && (
              <div style={{ color: tokens.ink[3] }}>No exceptions on this date — the weekly schedule applies.</div>
            )}
          </div>
          <div style={{ fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], lineHeight: 1.7, marginTop: 8 }}>
            Closures, private events and capacity are set in Admin → Calendar &amp; Closures, and apply here and on the guest page alike.
          </div>
        </div>
      </div>
    </div>
  );
}
