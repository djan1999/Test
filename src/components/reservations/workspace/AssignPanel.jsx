import { useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import CenteredModal from "../../ui/CenteredModal.jsx";
import { suggestTables, swapCandidates } from "../../../domain/reservations/availability.js";
import {
  FONT,
  chipStyle,
  darkButton,
  inputStyle,
  quietButton,
  sectionLabel,
  tableLabelOf,
  tablesOfBooking,
} from "./shared.js";

/**
 * Table assignment for a booking.
 *
 * Every table stays visible with the reason it is unavailable — a host can
 * read that reason to a guest on the phone. Choosing an occupied table opens
 * the resolution the old ResvForm offered:
 *
 *   · SWAP — only between two single-table bookings. Swapping a member of a
 *     combined group would leave the group pointing at a table it no longer
 *     holds, so the option is withheld rather than offered and then refused.
 *   · MOVE THEM — move the occupant to a table that genuinely fits them.
 *   · OVERRIDE — a manager may proceed anyway; the reason is required and is
 *     written to the audit trail.
 *
 * The view decides what to show. The server stays the authority for the write.
 */
export default function AssignPanel({ booking, bookings, config, onClose, onAssign, onSwap, onMove, onOverride }) {
  const [selected, setSelected] = useState(() => tablesOfBooking(booking));
  const [combine, setCombine] = useState(() => tablesOfBooking(booking).length > 1);
  const [conflict, setConflict] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");

  const candidates = useMemo(
    () => swapCandidates({ date: booking.date, time: booking.time, pax: booking.pax, bookings, config, reservationId: booking.id }),
    [booking, bookings, config],
  );

  const suggestion = useMemo(
    () => suggestTables({ date: booking.date, time: booking.time, pax: booking.pax, bookings, config, excludeId: booking.id }),
    [booking, bookings, config],
  );

  /** Tables the displaced party could move to instead — the MOVE THEM options. */
  const moveTargets = useMemo(() => {
    if (!conflict?.occupant) return [];
    const occupant = conflict.occupant;
    return swapCandidates({
      date: occupant.date,
      time: occupant.time,
      pax: occupant.pax,
      bookings,
      config,
      reservationId: occupant.id,
    }).filter((candidate) => candidate.free && candidate.table !== conflict.table);
  }, [conflict, bookings, config]);

  const pick = (candidate) => {
    if (selected.includes(candidate.table)) {
      setSelected(selected.filter((label) => label !== candidate.table));
      return;
    }
    if (candidate.free) {
      setSelected(combine ? [...selected, candidate.table] : [candidate.table]);
      return;
    }
    setConflict(candidate);
  };

  const canSwap = conflict?.occupant
    && selected.length === 1
    && tablesOfBooking(conflict.occupant).length === 1
    && tablesOfBooking(booking).length <= 1;

  return (
    <CenteredModal onClose={onClose} maxWidth={620} label={`Table · ${booking.name}`}>
      <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[2], fontWeight: 600 }}>
            Assign table · {booking.time} · {booking.pax}p
          </span>
          <button type="button" onClick={onClose} style={quietButton}>
            Close
          </button>
        </div>

        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.06em", color: tokens.green.text, fontWeight: 500, minHeight: 14 }}>
            {suggestion
              ? `Suggested: ${suggestion.tables.join("+")}${suggestion.combined ? " (combined)" : ""}`
              : "No clean fit — consider combining, or another seating."}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              type="button"
              style={darkButton}
              onClick={() => suggestion && setSelected(suggestion.tables)}
              disabled={!suggestion}
            >
              Auto-assign best
            </button>
            <button
              type="button"
              style={chipStyle(combine, { pad: "7px 11px", fs: 8 })}
              onClick={() => {
                setCombine(!combine);
                if (combine) setSelected(selected.slice(0, 1));
              }}
            >
              {combine ? "Combining ✓" : "+ Combine"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 5, marginTop: 12 }}>
            {candidates.map((candidate) => {
              const isSelected = selected.includes(candidate.table);
              const tooSmall = !combine && candidate.seats < booking.pax;
              const viable = candidate.free && !tooSmall;
              const reason = tooSmall
                ? `Too small — ${candidate.seats}s for ${booking.pax}p`
                : candidate.occupant
                  ? `Holds ${candidate.occupant.name} · ${candidate.occupant.time}`
                  : `${candidate.seats} seats`;
              return (
                <button
                  key={candidate.table}
                  type="button"
                  onClick={() => pick(candidate)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    minHeight: 34,
                    border: `1px solid ${isSelected ? tokens.charcoal.default : viable ? tokens.ink[4] : tokens.red.border}`,
                    background: isSelected ? tokens.tint.parchment : viable ? tokens.neutral[0] : tokens.red.bg,
                    color: isSelected ? tokens.ink[0] : viable ? tokens.ink[1] : tokens.red.text,
                    cursor: "pointer",
                    fontFamily: FONT,
                    overflow: "hidden",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, display: "block" }}>{candidate.table}</span>
                  <span style={{ fontSize: 8, letterSpacing: "0.04em", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {reason}
                  </span>
                </button>
              );
            })}
          </div>

          {conflict?.occupant && (
            <div style={{ border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0], padding: 10, marginTop: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.04em", color: tokens.ink[1], lineHeight: 1.7 }}>
                {conflict.table} holds {conflict.occupant.name} · {conflict.occupant.pax}p · {conflict.occupant.time}.{" "}
                {canSwap ? "Swap tables with them, or move them to a free table that fits." : "Move them to a free table that fits, or override."}
              </div>

              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                {canSwap && (
                  <button
                    type="button"
                    style={darkButton}
                    onClick={() => {
                      onSwap(booking, conflict.occupant);
                      setSelected([conflict.table]);
                      setConflict(null);
                    }}
                  >
                    Swap {tableLabelOf(booking)} ↔ {conflict.table}
                  </button>
                )}
                {moveTargets.map((target) => (
                  <button
                    key={target.table}
                    type="button"
                    style={chipStyle(false, { pad: "7px 10px", fs: 8 })}
                    onClick={() => {
                      onMove(conflict.occupant, target.table);
                      setSelected([conflict.table]);
                      setConflict(null);
                    }}
                  >
                    Move them → {target.table}
                  </button>
                ))}
              </div>

              {moveTargets.length === 0 && !canSwap && (
                <div style={{ fontSize: 8, color: tokens.signal.warn, marginTop: 6 }}>
                  No free table fits them — override is the only way through.
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <input
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Manager override reason (required)"
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                  <button
                    type="button"
                    style={{ ...quietButton, borderColor: tokens.red.border, background: tokens.red.bg, color: tokens.red.text }}
                    onClick={() => {
                      if (!overrideReason.trim()) return;
                      onOverride(booking, conflict.table, overrideReason.trim());
                      setSelected([conflict.table]);
                      setConflict(null);
                      setOverrideReason("");
                    }}
                  >
                    Override anyway
                  </button>
                  <button type="button" style={quietButton} onClick={() => setConflict(null)}>
                    Back
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], lineHeight: 1.8 }}>
            <span style={sectionLabel}>Selected:</span>{" "}
            <span style={{ color: tokens.ink[0], fontWeight: 600 }}>
              {selected.length ? selected.join("+") : "—"}
              {combine && selected.length > 1 ? " · combined" : ""}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={onClose} style={quietButton}>
              Cancel
            </button>
            <button type="button" style={darkButton} disabled={!selected.length} onClick={() => onAssign(booking, selected)}>
              Assign {selected.join("+") || "table"}
            </button>
          </div>
        </div>
      </div>
    </CenteredModal>
  );
}
