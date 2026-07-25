import { useMemo } from "react";
import { tokens } from "../../../styles/tokens.js";
import { durationForParty } from "../../../domain/reservations/config.js";
import { minutesOf, timeOf } from "../../../domain/reservations/availability.js";
import { FONT, STATUS_UI, isActiveBooking, restrictionFlags, tablesOfBooking } from "./shared.js";

const ROW_HEIGHT = 46;
const BLOCK_HEIGHT = 36;

/**
 * Tables against time — expected arrivals and booking capacity, never live
 * service. Each booking is a duration block with a dashed reset tail for the
 * turn buffer; a combined party appears on every table it holds with the
 * secondary marked; a pending booking is outlined rather than filled.
 *
 * Parties with no table yet are listed underneath rather than hidden, because
 * an unseated booking is the thing a host most needs to notice.
 */
export default function TimelineGrid({ date, service, bookings, config, onOpen, onBookGap }) {
  const windowStart = minutesOf(service.first) - 30;
  const windowEnd = minutesOf(service.last) + durationForParty(8, config) + config.durations.buffer;
  const span = Math.max(60, windowEnd - windowStart);
  const pct = (minutes) => Math.max(0, Math.min(100, ((minutes - windowStart) / span) * 100));

  const ticks = useMemo(() => {
    const out = [];
    for (let at = windowStart; at < windowEnd; at += 30) out.push(timeOf(at));
    return out;
  }, [windowStart, windowEnd]);

  const dayBookings = bookings.filter(
    (booking) => booking.date === date && booking.service === service.service && isActiveBooking(booking),
  );
  const unassigned = dayBookings.filter((booking) => tablesOfBooking(booking).length === 0);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 720, position: "relative", background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}` }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
            <div style={{ width: 120, flexShrink: 0, padding: "8px 12px", fontSize: 9, letterSpacing: "0.12em", color: tokens.ink[3], borderRight: `1px solid ${tokens.ink[5]}` }}>
              TABLE
            </div>
            <div style={{ flex: 1, display: "flex" }}>
              {ticks.map((tick) => (
                <span key={tick} style={{ flex: 1, padding: "8px 0 8px 6px", fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], borderRight: `1px solid ${tokens.neutral[100]}` }}>
                  {tick}
                </span>
              ))}
            </div>
          </div>

          {config.tables.map((table) => {
            const label = String(table.id);
            const held = dayBookings.filter((booking) => tablesOfBooking(booking).includes(label));
            const firstGap = !held.length ? service.first : null;

            return (
              <div key={label} style={{ display: "flex", borderBottom: `1px solid ${tokens.ink[5]}`, height: ROW_HEIGHT, alignItems: "center" }}>
                <div style={{ width: 120, flexShrink: 0, padding: "0 12px", borderRight: `1px solid ${tokens.ink[5]}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>{label}</span>
                  <span style={{ fontSize: 8, color: tokens.ink[3], marginLeft: 8 }}>{table.seats}s</span>
                </div>
                <div style={{ flex: 1, position: "relative", height: "100%" }}>
                  {held.map((booking) => {
                    const ui = STATUS_UI[booking.status] || STATUS_UI.confirmed;
                    const start = minutesOf(booking.time);
                    const end = start + durationForParty(booking.pax, config);
                    const group = tablesOfBooking(booking);
                    const isPrimary = group[0] === label;
                    const pending = booking.status === "pending";
                    const flags = restrictionFlags(booking);
                    return (
                      <div key={`${booking.id}-${label}`}>
                        <button
                          type="button"
                          onClick={() => onOpen(booking)}
                          style={{
                            position: "absolute",
                            left: `${pct(start)}%`,
                            width: `${pct(end) - pct(start)}%`,
                            top: 5,
                            height: BLOCK_HEIGHT,
                            boxSizing: "border-box",
                            textAlign: "left",
                            background: isPrimary ? tokens.neutral[0] : tokens.neutral[50],
                            border: pending ? `1px dashed ${tokens.ink[3]}` : `1px solid ${ui.rule}`,
                            borderLeft: pending ? `1px dashed ${tokens.ink[3]}` : `2px solid ${ui.rule}`,
                            padding: "2px 8px",
                            lineHeight: 1.35,
                            overflow: "hidden",
                            cursor: "pointer",
                            fontFamily: FONT,
                            opacity: booking.status === "completed" ? 0.55 : 1,
                          }}
                        >
                          <span style={{ fontSize: 9, fontWeight: 600, display: "block", whiteSpace: "nowrap", overflow: "hidden", color: tokens.ink[0] }}>
                            {booking.name.split(",")[0].toUpperCase()} {booking.pax}p{group.length > 1 && !isPrimary ? " ▲" : ""}
                          </span>
                          <span
                            style={{
                              fontSize: 8,
                              display: "block",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              color: flags.length ? tokens.signal.alert : tokens.ink[3],
                              fontWeight: flags.length ? 600 : 400,
                            }}
                          >
                            {group.length > 1 && !isPrimary
                              ? `joined with ${group.filter((t) => t !== label).join("+")}`
                              : `${booking.time}${flags.length ? ` · ${flags.join("")}` : ""}`}
                          </span>
                        </button>
                        {isPrimary && booking.status !== "completed" && (
                          <div
                            title="Turn buffer"
                            style={{
                              position: "absolute",
                              left: `${pct(end)}%`,
                              width: `${pct(end + config.durations.buffer) - pct(end)}%`,
                              top: 5,
                              height: BLOCK_HEIGHT,
                              boxSizing: "border-box",
                              background: tokens.neutral[100],
                              borderTop: `1px dashed ${tokens.neutral[300]}`,
                              borderRight: `1px dashed ${tokens.neutral[300]}`,
                              borderBottom: `1px dashed ${tokens.neutral[300]}`,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {firstGap && onBookGap && (
                    <button
                      type="button"
                      onClick={() => onBookGap(date, service.service, firstGap, label)}
                      style={{
                        position: "absolute",
                        left: `${pct(minutesOf(firstGap))}%`,
                        width: `${pct(minutesOf(firstGap) + 90) - pct(minutesOf(firstGap))}%`,
                        top: 5,
                        height: BLOCK_HEIGHT,
                        boxSizing: "border-box",
                        textAlign: "left",
                        background: tokens.neutral[0],
                        border: `1px dashed ${tokens.neutral[300]}`,
                        padding: "2px 8px",
                        lineHeight: 1.35,
                        overflow: "hidden",
                        cursor: "pointer",
                        fontFamily: FONT,
                        color: tokens.ink[2],
                      }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 600, display: "block" }}>+ {firstGap}</span>
                      <span style={{ fontSize: 8, color: tokens.neutral[400], display: "block" }}>free — tap to book</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {unassigned.length > 0 && (
        <div style={{ marginTop: 10, border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0], padding: "10px 12px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.signal.warn, fontWeight: 600 }}>
            No table yet · {unassigned.length}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {unassigned.map((booking) => (
              <button
                key={booking.id}
                type="button"
                onClick={() => onOpen(booking)}
                style={{
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  padding: "7px 10px",
                  minHeight: 34,
                  border: `1px solid ${tokens.ink[4]}`,
                  background: tokens.neutral[0],
                  color: tokens.ink[1],
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                {booking.time} · {booking.name} · {booking.pax}p
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
