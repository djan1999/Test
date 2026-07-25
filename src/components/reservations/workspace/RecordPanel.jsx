import { tokens } from "../../../styles/tokens.js";
import CenteredModal from "../../ui/CenteredModal.jsx";
import { durationForParty } from "../../../domain/reservations/config.js";
import { canTransitionReservation, statusLabel } from "../../../domain/reservations/lifecycle.js";
import { RESERVATION_STATUSES } from "../../../domain/reservations/lifecycle.js";
import {
  FONT,
  STATUS_UI,
  dangerButton,
  darkButton,
  dayLabel,
  quietButton,
  restrictionFlags,
  sectionLabel,
  squareStyle,
  tableLabelOf,
} from "./shared.js";

const ACTION_LABEL = {
  confirmed: "Confirm",
  arrived: "Mark arrived",
  completed: "Mark visit complete",
  cancelled: "Cancel",
  no_show: "No-show",
  pending: "Reinstate as pending",
};

/**
 * The full record: what was booked, the hospitality detail the kitchen needs,
 * and the status history. Only the transitions the lifecycle actually allows
 * from here are offered — an illegal move is never rendered as a dead button.
 */
export default function RecordPanel({ booking, config, statusEvents, onClose, onTransition, onEdit, onDuplicate, canEdit }) {
  if (!booking) return null;
  const status = booking.status || "confirmed";
  const ui = STATUS_UI[status] || STATUS_UI.confirmed;
  const operational = booking.operationalData || {};
  const events = statusEvents || booking.statusEvents || booking.status_events || [];

  const actions = RESERVATION_STATUSES.filter((next) => canTransitionReservation(status, next));

  const specs = [
    { k: "Date", v: `${dayLabel(booking.date)} ${booking.date.slice(0, 4)}` },
    { k: "Service", v: (booking.service || "dinner").toUpperCase() },
    { k: "Arrival", v: booking.time || "—" },
    { k: "Turn", v: `${durationForParty(booking.pax, config)} + ${config.durations.buffer} min` },
    { k: "Party", v: `${booking.pax} covers` },
    { k: "Table", v: tableLabelOf(booking) },
    { k: "Experience", v: booking.experience || operational.menuType || "—" },
    { k: "Language", v: (booking.language || "en").toUpperCase() },
    { k: "Mobile", v: booking.phone || "—" },
    { k: "Email", v: booking.email || "—" },
    { k: "Hotel", v: operational.guestType === "hotel" ? `Room ${(operational.rooms || []).join(", ") || operational.room || "—"}` : "—" },
    { k: "Source", v: (booking.source || "phone").toUpperCase() },
  ];

  const flags = restrictionFlags(booking);
  const hospitality = [
    operational.birthday ? `Cake — ${operational.cakeNote || "occasion"}` : "",
    booking.occasion || "",
    booking.notes || operational.notes || "",
  ].filter(Boolean);

  return (
    <CenteredModal onClose={onClose} maxWidth={760} label={`Reservation · ${booking.ref || booking.id}`}>
      <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[2], fontWeight: 600 }}>
            Reservation · {(booking.ref || booking.id || "").toString().toUpperCase()}
          </span>
          <button type="button" onClick={onClose} style={quietButton}>
            Close
          </button>
        </div>

        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: tokens.ink[0] }}>
              {booking.name}{" "}
              {(operational.tags || []).includes("vip") && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>[VIP]</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={squareStyle(ui.square, 8)} />
              <span style={{ fontSize: 9, letterSpacing: "0.14em", fontWeight: 600, color: ui.color, textTransform: "uppercase" }}>
                {statusLabel(status)}
              </span>
            </div>
          </div>

          {canEdit && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12 }}>
              {actions.map((next) => {
                const danger = next === "cancelled" || next === "no_show";
                return (
                  <button key={next} type="button" onClick={() => onTransition(booking, next)} style={danger ? dangerButton : darkButton}>
                    {ACTION_LABEL[next] || statusLabel(next)}
                  </button>
                );
              })}
              <button type="button" onClick={() => onEdit(booking)} style={quietButton}>
                Edit
              </button>
              <button type="button" onClick={() => onDuplicate(booking)} style={quietButton}>
                Duplicate
              </button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: tokens.ink[5], border: `1px solid ${tokens.ink[5]}`, marginTop: 14 }}>
            {specs.map((spec) => (
              <div key={spec.k} style={{ background: tokens.neutral[0], padding: "8px 10px" }}>
                <div style={{ fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3] }}>{spec.k}</div>
                <div style={{ fontSize: 11, color: tokens.ink[0], marginTop: 3, fontWeight: 500 }}>{spec.v}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <span style={sectionLabel}>[Hospitality]</span>
            <div style={{ fontSize: 10, color: tokens.signal.alert, fontWeight: 600, letterSpacing: "0.06em", marginTop: 6 }}>
              {flags.length ? flags.join("  ") : "No restrictions recorded"}
            </div>
            {hospitality.length > 0 && (
              <div style={{ fontSize: 10, color: tokens.ink[2], marginTop: 4, lineHeight: 1.6 }}>{hospitality.join(" · ")}</div>
            )}
            {(booking.accessibility || []).length > 0 && (
              <div style={{ fontSize: 10, color: tokens.ink[2], marginTop: 4, lineHeight: 1.6 }}>
                Access — {booking.accessibility.join(", ")}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <span style={sectionLabel}>[Status history]</span>
            <div style={{ fontSize: 9, letterSpacing: "0.04em", color: tokens.ink[2], lineHeight: 2, marginTop: 6, borderLeft: `1px solid ${tokens.ink[5]}`, paddingLeft: 10 }}>
              {events.length ? (
                events.map((event, index) => (
                  <div key={index}>
                    {(event.at || event.createdAt || "").toString().slice(0, 16).replace("T", " ")} ·{" "}
                    {event.from ? `${statusLabel(event.from)} → ` : ""}
                    {statusLabel(event.to || event.status)}
                    {event.reason ? ` · “${event.reason}”` : ""}
                    {event.by || event.actor ? ` — ${event.by || event.actor}` : ""}
                  </div>
                ))
              ) : (
                <div>No changes recorded</div>
              )}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${tokens.ink[5]}`, marginTop: 14, paddingTop: 10, fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], lineHeight: 1.8 }}>
            Status changes are recorded in the reservations domain only. The live Service board is untouched.
          </div>
        </div>
      </div>
    </CenteredModal>
  );
}
