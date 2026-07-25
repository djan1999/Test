import { tokens } from "../../../styles/tokens.js";
import { suggestTables } from "../../../domain/reservations/availability.js";
import { FONT, darkButton, dayLabel, quietButton, sectionLabel } from "./shared.js";

// The server hands entries back as
//   { id, date, service, time, window, name, phone, email, pax, quotedMinutes,
//     notes, status, createdAt }
// and keeps removed and converted rows in the table, so the list filters them
// out rather than showing a party that is no longer waiting.
const WAITING = new Set(["waiting", "notified", "", undefined, null]);

/**
 * Unplaced demand.
 *
 * CONVERT opens the party as a booking on the date and service they actually
 * asked for — nothing is retyped, and nothing is invented. REMOVE asks for a
 * reason. A suggested table appears only where one genuinely fits: it is a
 * hint for the host, not an automatic placement, and nobody is messaged
 * without a person deciding to.
 */
export default function WaitlistTab({ waitlist, bookings, config, onConvert, onRemove, canEdit, isMobile }) {
  const waiting = (waitlist || []).filter((entry) => WAITING.has(entry.status));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 420px", maxWidth: 680, background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}` }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={sectionLabel}>[Waitlist — unplaced demand · {waiting.length}]</span>
        </div>

        <div style={{ padding: "2px 14px 8px" }}>
          {waiting.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3] }}>
              Nobody waiting
            </div>
          )}

          {waiting.map((entry) => {
            // The entry carries its own date and service — a suggestion is only
            // honest if it is checked against the evening they asked for.
            const probeTime = entry.time || "";
            const suggestion = entry.date && probeTime
              ? suggestTables({ date: entry.date, time: probeTime, pax: entry.pax, bookings, config })
              : null;

            const meta = [
              entry.date ? dayLabel(entry.date) : "",
              entry.service ? entry.service.toUpperCase() : "",
              entry.time ? `req ${entry.time}` : "",
              entry.window ? `flex ${entry.window}` : "",
              entry.quotedMinutes ? `quoted ${entry.quotedMinutes}m` : "",
              entry.createdAt ? `added ${String(entry.createdAt).slice(0, 16).replace("T", " ")}` : "",
            ].filter(Boolean);

            return (
              <div key={entry.id} style={{ borderBottom: `1px solid ${tokens.ink[5]}`, padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, color: tokens.ink[0] }}>{entry.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tokens.ink[0] }}>{entry.pax}P</span>
                </div>

                <div style={{ fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], marginTop: 3, textTransform: "uppercase" }}>
                  {meta.join(" · ")}
                </div>

                {(entry.phone || entry.email) && (
                  <div style={{ fontSize: 9, letterSpacing: "0.04em", color: tokens.ink[2], marginTop: 3 }}>
                    {[entry.phone, entry.email].filter(Boolean).join(" · ")}
                  </div>
                )}

                {entry.notes && <div style={{ fontSize: 9, color: tokens.ink[2], marginTop: 3, lineHeight: 1.6 }}>{entry.notes}</div>}

                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.06em",
                    marginTop: 4,
                    color: suggestion ? tokens.green.text : tokens.ink[3],
                    fontWeight: suggestion ? 500 : 400,
                  }}
                >
                  {suggestion
                    ? `✓ ${suggestion.tables.join("+")} could take them at ${probeTime}`
                    : probeTime
                      ? "Nothing fits that time — convert onto another seating"
                      : "No time requested — convert and choose one"}
                </div>

                {canEdit && (
                  <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                    <button type="button" style={darkButton} onClick={() => onConvert(entry, suggestion)}>
                      Convert
                    </button>
                    <button type="button" style={quietButton} onClick={() => onRemove(entry)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!isMobile && (
        <div style={{ flex: "0 1 300px", background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "12px 14px" }}>
          <span style={sectionLabel}>[How it works]</span>
          <div style={{ fontSize: 9, color: tokens.ink[2], lineHeight: 1.9, marginTop: 8, fontFamily: FONT }}>
            Convert books the party on the date and service they asked for, so nothing is retyped. Removal asks for a reason and is
            recorded. When a cancellation frees a table, a match appears here — a person always confirms before anyone is called.
          </div>
        </div>
      )}
    </div>
  );
}
