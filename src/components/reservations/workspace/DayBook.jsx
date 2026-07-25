import { tokens } from "../../../styles/tokens.js";
import { statusLabel } from "../../../domain/reservations/lifecycle.js";
import {
  FONT,
  STATUS_UI,
  chipStyle,
  coversOf,
  darkButton,
  quietButton,
  restrictionFlags,
  squareStyle,
  tableLabelOf,
} from "./shared.js";

/**
 * Day Book — the planning view of a day's reservations, grouped by seating.
 *
 * Deliberately not a second Service screen: it answers who is booked, how many
 * covers, what is still unconfirmed and who has an allergy. Arrival and
 * seating stay with Service.
 */
export default function DayBook({ shown, counts, filter, onFilter, config, onOpen, onConfirm, onAssign, canEdit, isMobile, emptyLabel }) {
  const filters = [
    ["all", `All ${counts.all}`],
    ["pending", `Pending ${counts.pending}`],
    ["confirmed", `Confirmed ${counts.confirmed}`],
    ["allergy", `Allergy ${counts.allergy}`],
    ["hotel", `Hotel ${counts.hotel}`],
    ["notable", `No table ${counts.notable}`],
    ["closed", `Closed ${counts.closed}`],
  ];

  const times = [...new Set(shown.map((booking) => booking.time || "—"))].sort();

  return (
    <div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {filters.map(([key, label]) => (
          <button key={key} type="button" style={chipStyle(filter === key, { pad: "7px 11px", touch: true })} onClick={() => onFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {times.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 24, marginBottom: 12, letterSpacing: "0.10em", color: tokens.ink[4] }}>[ ]</div>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[3] }}>{emptyLabel}</div>
        </div>
      )}

      {times.map((time) => {
        const rows = shown.filter((booking) => (booking.time || "—") === time);
        return (
          <div key={time}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 0 6px" }}>
              <span style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 600, color: tokens.ink[0] }}>{time}</span>
              <span style={{ fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3] }}>
                SEATING · {coversOf(rows)} COVERS
              </span>
              <span style={{ flex: 1, borderBottom: `1px solid ${tokens.ink[4]}` }} />
            </div>
            {rows.map((booking) => (
              <Row
                key={booking.id}
                booking={booking}
                config={config}
                isMobile={isMobile}
                canEdit={canEdit}
                onOpen={onOpen}
                onConfirm={onConfirm}
                onAssign={onAssign}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Row({ booking, isMobile, canEdit, onOpen, onConfirm, onAssign }) {
  const ui = STATUS_UI[booking.status] || STATUS_UI.confirmed;
  const operational = booking.operationalData || {};
  const closed = ["cancelled", "no_show", "completed"].includes(booking.status);
  const flags = restrictionFlags(booking);
  const table = tableLabelOf(booking);
  const hasTable = table !== "—";

  const info = [];
  if (operational.guestType === "hotel") {
    const rooms = (operational.rooms || []).filter(Boolean);
    info.push(`ROOM ${rooms.join(", ") || operational.room || "?"}`);
  }
  if (operational.birthday) info.push(`CAKE${operational.cakeNote ? ` · ${operational.cakeNote.toUpperCase()}` : ""}`);

  const sub = [];
  if (booking.notes || operational.notes) sub.push(booking.notes || operational.notes);
  if (booking.language) sub.push(booking.language.toUpperCase());

  const base = {
    background: tokens.neutral[0],
    border: `1px solid ${tokens.ink[5]}`,
    borderLeft: `2px solid ${ui.rule}`,
    padding: "10px 12px",
    marginBottom: 6,
    opacity: closed ? 0.6 : 1,
  };

  const style = isMobile
    ? { ...base, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 8 }
    : {
        ...base,
        display: "grid",
        gridTemplateColumns: "104px minmax(110px,1.4fr) 34px 72px minmax(0,1fr) minmax(150px,auto)",
        alignItems: "center",
        gap: 8,
      };

  return (
    <div style={style}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={squareStyle(ui.square)} />
          <span style={{ fontSize: 8, letterSpacing: "0.14em", fontWeight: 500, color: ui.color, textTransform: "uppercase" }}>
            {statusLabel(booking.status)}
          </span>
        </div>
        {booking.ref && (
          <div style={{ fontSize: 8, color: tokens.ink[3], marginTop: 3, letterSpacing: "0.04em" }}>{booking.ref}</div>
        )}
      </div>

      <div style={isMobile ? { minWidth: 0, flex: "1 1 150px" } : { minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: tokens.ink[0],
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: booking.status === "cancelled" ? "line-through" : "none",
          }}
        >
          {booking.name}{" "}
          {(operational.tags || []).includes("vip") && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: tokens.ink[0] }}>[VIP]</span>
          )}
        </div>
        {sub.length > 0 && (
          <div style={{ fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], marginTop: 2, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sub.join(" · ")}
          </div>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.ink[0] }}>{booking.pax}</div>

      <button
        type="button"
        onClick={() => canEdit && onAssign(booking)}
        disabled={!canEdit}
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          border: `1px solid ${hasTable ? tokens.charcoal.default : tokens.signal.warn}`,
          background: hasTable ? tokens.neutral[50] : tokens.neutral[0],
          padding: "6px 0",
          minHeight: 34,
          textAlign: "center",
          color: hasTable ? tokens.ink[0] : tokens.signal.warn,
          cursor: canEdit ? "pointer" : "default",
          fontFamily: FONT,
        }}
      >
        {hasTable ? table : "ASSIGN"}
      </button>

      <div style={{ minWidth: 0, overflow: "hidden" }}>
        {flags.length > 0 && (
          <span style={{ fontSize: 9, color: tokens.signal.alert, fontWeight: 600, letterSpacing: "0.06em" }}>{flags.join(" ")}</span>
        )}{" "}
        {info.length > 0 && (
          <span style={{ fontSize: 9, color: tokens.ink[2], letterSpacing: "0.06em", textTransform: "uppercase" }}>{info.join(" · ")}</span>
        )}
      </div>

      <div
        style={
          isMobile
            ? { display: "flex", gap: 5, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", flex: "1 0 100%" }
            : { display: "flex", gap: 5, justifyContent: "flex-end", alignItems: "center" }
        }
      >
        {canEdit && booking.status === "pending" && (
          <button type="button" onClick={() => onConfirm(booking)} style={darkButton}>
            Confirm
          </button>
        )}
        <button type="button" onClick={() => onOpen(booking)} style={quietButton}>
          Record
        </button>
      </div>
    </div>
  );
}
