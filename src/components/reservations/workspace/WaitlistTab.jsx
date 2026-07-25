import { tokens } from "../../../styles/tokens.js";
import { suggestTables } from "../../../domain/reservations/availability.js";
import { FONT, darkButton, quietButton, sectionLabel } from "./shared.js";

/**
 * Unplaced demand.
 *
 * CONVERT opens the booking form already filled in, so a party is never
 * retyped. REMOVE asks for a reason. A suggested table is offered where one
 * genuinely fits — it is a hint for the host, not an automatic placement, and
 * nobody is messaged without a person deciding to.
 */
export default function WaitlistTab({ waitlist, bookings, config, date, services, onConvert, onRemove, canEdit, isMobile }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 420px", maxWidth: 680, background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}` }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={sectionLabel}>[Waitlist — unplaced demand · {waitlist.length}]</span>
        </div>

        <div style={{ padding: "2px 14px 8px" }}>
          {waitlist.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3] }}>
              Nobody waiting
            </div>
          )}

          {waitlist.map((entry) => {
            const requested = entry.requestedTime || entry.req || "";
            const service = services.find((item) => item.service === (entry.service || "dinner")) || services[0];
            const probeTime = requested || service?.last || "";
            const suggestion = probeTime
              ? suggestTables({ date, time: probeTime, pax: entry.pax, bookings, config })
              : null;
            const restrictions = Array.isArray(entry.restrictions) ? entry.restrictions : [];

            const meta = [
              requested ? `REQ ${requested}` : "",
              entry.flexibility || entry.flex ? `FLEX ${entry.flexibility || entry.flex}` : "",
              entry.quotedMinutes || entry.quoted ? `QUOTED ${entry.quotedMinutes || entry.quoted}M` : "",
              entry.addedAt ? `ADDED ${String(entry.addedAt).slice(0, 16).replace("T", " ")}` : "",
              entry.source === "web" ? "WEB" : "",
            ].filter(Boolean);

            return (
              <div key={entry.id} style={{ borderBottom: `1px solid ${tokens.ink[5]}`, padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, color: tokens.ink[0] }}>
                    {entry.name}
                    {entry.priority || entry.vip ? (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginLeft: 6 }}>[VIP]</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tokens.ink[0] }}>{entry.pax}P</span>
                </div>

                <div style={{ fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], marginTop: 3, textTransform: "uppercase" }}>
                  {meta.join(" · ")}
                </div>

                {entry.phone && (
                  <div style={{ fontSize: 9, letterSpacing: "0.04em", color: tokens.ink[2], marginTop: 3 }}>{entry.phone}</div>
                )}

                {restrictions.length > 0 && (
                  <div style={{ fontSize: 9, color: tokens.signal.alert, fontWeight: 600, letterSpacing: "0.06em", marginTop: 3 }}>
                    {restrictions.map((item) => `[${String(item.note || item).toUpperCase()}]`).join(" ")}
                  </div>
                )}

                {entry.notes && (
                  <div style={{ fontSize: 9, color: tokens.ink[2], marginTop: 3, lineHeight: 1.6 }}>{entry.notes}</div>
                )}

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
                    : "No fit in this service — convert onto another date or seating"}
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
            Convert opens the booking form pre-filled for any date and seating, so nothing is retyped. Removal asks for a reason and is
            recorded. When a cancellation frees a table, matching parties surface here and in the Day Book — a person always confirms
            before anyone is called.
          </div>
        </div>
      )}
    </div>
  );
}
