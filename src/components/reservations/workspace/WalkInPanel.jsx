import { useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import CenteredModal from "../../ui/CenteredModal.jsx";
import { generateSlots, suggestTables } from "../../../domain/reservations/availability.js";
import { FONT, inputStyle, labelStyle, quietButton } from "./shared.js";

/**
 * Walk-in fast entry.
 *
 * Records the party as a reservation so the day book and the printed sheets
 * stay complete — it does not seat anyone. Seating belongs to Service, which
 * this workspace never writes to.
 *
 * Only seatings and tables that genuinely fit the party are offered; the host
 * is never shown an option the availability engine would refuse.
 */
export default function WalkInPanel({ date, services, bookings, config, onClose, onRecord }) {
  const [pax, setPax] = useState(2);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const options = services
    .filter((service) => service.walkInsEnabled !== false)
    .flatMap((service) =>
      generateSlots(service.first, service.last, service.interval).map((time) => {
        const suggestion = suggestTables({ date, time, pax, bookings, config });
        return { service: service.service, time, suggestion };
      }),
    )
    .filter((option) => option.suggestion);

  return (
    <CenteredModal onClose={onClose} maxWidth={560} label="Walk-in">
      <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[2], fontWeight: 600 }}>
            Walk-in — record a party
          </span>
          <button type="button" onClick={onClose} style={quietButton}>
            Close
          </button>
        </div>

        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Name (optional)</div>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Walk-in" style={inputStyle} />
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Party</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => setPax(Math.max(1, pax - 1))} style={{ ...quietButton, width: 44, height: 44, fontSize: 16 }}>
                  −
                </button>
                <span style={{ fontSize: 16, minWidth: 24, textAlign: "center", color: tokens.ink[0] }}>{pax}</span>
                <button type="button" onClick={() => setPax(Math.min(14, pax + 1))} style={{ ...quietButton, width: 44, height: 44, fontSize: 16 }}>
                  +
                </button>
              </div>
            </div>
          </div>

          <div style={{ ...labelStyle, marginBottom: 6 }}>Seatings that fit {pax} — tap to record</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 5 }}>
            {options.map((option) => (
              <button
                key={`${option.service}-${option.time}`}
                type="button"
                onClick={() => {
                  setError("");
                  onRecord({
                    date,
                    service: option.service,
                    time: option.time,
                    pax,
                    name: name.trim() || "Walk-in",
                    tables: option.suggestion.tables,
                  });
                }}
                style={{
                  padding: "10px 8px",
                  minHeight: 44,
                  border: `1px solid ${tokens.green.border}`,
                  background: tokens.green.bg,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: tokens.green.strong, display: "block" }}>
                  {option.time} · {option.suggestion.tables.join("+")}
                </span>
                <span style={{ fontSize: 8, letterSpacing: "0.06em", color: tokens.green.text }}>
                  {option.service.toUpperCase()}
                  {option.suggestion.combined ? " · combined" : ""}
                </span>
              </button>
            ))}
          </div>

          {options.length === 0 && (
            <div style={{ fontSize: 9, letterSpacing: "0.06em", color: tokens.signal.warn, marginTop: 10, lineHeight: 1.7 }}>
              Nothing fits {pax} today — take them onto the waitlist instead.
            </div>
          )}

          {error && <div style={{ fontSize: 9, color: tokens.red.text, marginTop: 8 }}>{error}</div>}

          <div style={{ fontSize: 8, letterSpacing: "0.06em", color: tokens.ink[3], marginTop: 12, lineHeight: 1.7 }}>
            The party is recorded as arrived so the day book and the kitchen sheets stay complete. Seating and service are unaffected.
          </div>
        </div>
      </div>
    </CenteredModal>
  );
}
