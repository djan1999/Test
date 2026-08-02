import { useMemo } from "react";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

const MODE_COPY = {
  move: {
    title: "[MOVE TABLE]",
    lead: "Move this party to a different table. Everything travels — orders, kitchen log, arrival time and the booking itself.",
  },
  swap: {
    title: "[SWAP TABLES]",
    lead: "Exchange this party with the party on another table. Both sides keep their own orders and kitchen log.",
  },
  join: {
    title: "[JOIN TABLE]",
    lead: "Add a table to this booking. The two tables are served as one combined party.",
  },
};

/**
 * The one-line reason a candidate table is or is not a good destination.
 *
 * Never a bare table number: the operator picking a table mid-service is
 * deciding against the room, and the number alone doesn't say whether the
 * table is free, who is holding it, or whether the party even fits.
 *
 * @returns {{ text: string, tone: "free"|"held"|"live"|"tight" }}
 */
export function candidateReason({ table, owner, nextBooking, seatCap, partySize }) {
  const pax = owner?.data?.guests || table?.guests || null;
  const name = (table?.resName || owner?.data?.resName || "").trim();
  const capShort = Number.isFinite(seatCap) && Number.isFinite(partySize) && seatCap > 0 && seatCap < partySize;

  if (table?.active || table?.arrivedAt) {
    return {
      text: `LIVE — ${(name || "IN SERVICE").toUpperCase()}${pax ? ` (${pax})` : ""}`,
      tone: "live",
    };
  }
  if (name || table?.resTime || owner) {
    const time = table?.resTime || owner?.data?.resTime || "";
    return {
      text: `HELD${time ? ` ${time}` : ""} — ${(name || "RESERVED").toUpperCase()}${pax ? ` (${pax})` : ""}`,
      tone: "held",
    };
  }
  if (capShort) {
    return { text: `SEATS ${seatCap} — PARTY ${partySize}`, tone: "tight" };
  }
  return {
    text: nextBooking ? `FREE UNTIL ${nextBooking}` : "FREE",
    tone: "free",
  };
}

const TONE = {
  free:  { color: tokens.green.text, border: tokens.green.border, bg: tokens.neutral[0] },
  held:  { color: tokens.ink[2],     border: tokens.ink[4],       bg: tokens.neutral[50] },
  live:  { color: tokens.red.text,   border: tokens.red.border,   bg: tokens.red.bg },
  tight: { color: tokens.signal.warn, border: tokens.ink[4],      bg: tokens.neutral[50] },
};

/**
 * Candidate-table picker shared by MOVE / SWAP / JOIN.
 *
 * `pickable(candidate)` decides which rows are tappable — JOIN only accepts a
 * genuinely free table, MOVE and SWAP accept anything but the table itself
 * (App resolves an occupied destination into a swap).
 */
export default function TablePickerModal({
  mode = "move",
  currentTable,
  tables = [],
  reservations = [],
  reservationOnTable,
  seatCapOf,
  pickable,
  onPick,
  onCancel,
}) {
  useModalEscape(onCancel, true);
  const copy = MODE_COPY[mode] || MODE_COPY.move;
  const partySize = Number(currentTable?._groupGuests || currentTable?.guests) || null;

  const candidates = useMemo(() => {
    const memberIds = new Set([
      Number(currentTable?.id),
      ...((currentTable?.tableGroup || []).map(Number)),
    ]);
    return (tables || [])
      .filter(t => !memberIds.has(Number(t.id)))
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map(t => {
        const owner = typeof reservationOnTable === "function" ? reservationOnTable(t.id) : null;
        // The next booking that will claim this table later tonight — what
        // makes "FREE" honest as "FREE UNTIL 21:00".
        const nextBooking = (reservations || [])
          .filter(r => (r.data?.tableGroup?.length > 1 ? r.data.tableGroup : [r.table_id])
            .map(Number).includes(Number(t.id)))
          .map(r => r.data?.resTime)
          .filter(Boolean)
          .sort()
          .find(time => time > (currentTable?.resTime || "")) || null;
        const seatCap = typeof seatCapOf === "function" ? seatCapOf(t.id) : null;
        return {
          table: t,
          reason: candidateReason({ table: t, owner, nextBooking, seatCap, partySize }),
          enabled: typeof pickable === "function" ? pickable(t, owner) : true,
        };
      });
  }, [tables, currentTable, reservations, reservationOnTable, seatCapOf, pickable, partySize]);

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: tokens.surface.overlay,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 400, padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={e => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
          maxWidth: 420, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
          fontFamily: FONT,
        }}
      >
        <div style={{ padding: "16px 16px 10px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>
            {copy.title}
          </div>
          <div style={{ fontSize: 11, color: tokens.ink[1], lineHeight: 1.5 }}>{copy.lead}</div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {candidates.length === 0 && (
            <div style={{ padding: "20px 16px", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[4] }}>
              no candidate tables
            </div>
          )}
          {candidates.map(({ table, reason, enabled }) => {
            const tone = TONE[reason.tone] || TONE.held;
            return (
              <button
                key={table.id}
                type="button"
                disabled={!enabled}
                onClick={() => enabled && onPick(Number(table.id))}
                style={{
                  width: "100%", minHeight: 56, textAlign: "left",
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 16px", border: "none",
                  borderBottom: `1px solid ${tokens.ink[5]}`,
                  borderLeft: `3px solid ${tone.border}`,
                  background: enabled ? tone.bg : tokens.neutral[50],
                  cursor: enabled ? "pointer" : "not-allowed",
                  opacity: enabled ? 1 : 0.45,
                  fontFamily: FONT, touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: tokens.ink[0], minWidth: 52 }}>
                  {table.displayLabel || `T${String(table.id).padStart(2, "0")}`}
                </span>
                <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: tone.color, lineHeight: 1.4 }}>
                  {reason.text}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${tokens.ink[4]}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              minHeight: 44, padding: "8px 20px", border: `1px solid ${tokens.ink[4]}`,
              borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2],
            }}
          >CANCEL</button>
        </div>
      </div>
    </div>
  );
}
