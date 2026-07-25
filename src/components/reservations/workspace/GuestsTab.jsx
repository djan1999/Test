import { Suspense, lazy, useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import { statusLabel } from "../../../domain/reservations/lifecycle.js";
import {
  FONT,
  darkButton,
  inputStyle,
  quietButton,
  restrictionsOf,
  sectionLabel,
  shortDay,
  tableLabelOf,
} from "./shared.js";

// The archive-based history the old manager showed, unchanged.
const GuestMemory = lazy(() => import("../GuestMemory.jsx"));

const VISITED = new Set(["arrived", "completed"]);
const digitsOf = (value) => String(value || "").replace(/\D/g, "");

/**
 * A guest directory derived from the bookings themselves: visits, last visit,
 * cancellations, no-shows, the union of restrictions across every visit, hotel
 * rooms and language.
 *
 * Duplicate detection is by telephone number, and merging is always a
 * deliberate action — two people can share a phone, so the panel proposes and
 * a human decides. The merge control only appears when a handler is wired.
 */
export default function GuestsTab({ bookings, query, onQuery, selectedName, onSelect, onBookFor, onMergeGuests, canEdit, isMobile }) {
  const [showMemory, setShowMemory] = useState(true);

  const directory = useMemo(() => {
    const byName = new Map();
    bookings.forEach((booking) => {
      const name = String(booking.name || "").trim();
      if (!name || name.toLowerCase() === "walk-in") return;
      const key = name.toLowerCase();
      const entry = byName.get(key) || { key, name, bookings: [] };
      entry.bookings.push(booking);
      byName.set(key, entry);
    });

    const byPhone = new Map();
    byName.forEach((entry) => {
      const phone = digitsOf(entry.bookings.map((booking) => booking.phone).find(Boolean));
      if (phone.length >= 6) byPhone.set(phone, [...(byPhone.get(phone) || []), entry.key]);
    });

    return [...byName.values()]
      .map((entry) => {
        const sorted = [...entry.bookings].sort(
          (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.time).localeCompare(String(a.time)),
        );
        const phone = entry.bookings.map((booking) => booking.phone).find(Boolean) || "";
        const restrictions = new Map();
        entry.bookings.forEach((booking) =>
          restrictionsOf(booking).forEach((item) => {
            const note = String(item.note || item.key || "").trim();
            if (note) restrictions.set(note.toLowerCase(), note);
          }),
        );
        return {
          ...entry,
          sorted,
          phone,
          email: entry.bookings.map((booking) => booking.email).find(Boolean) || "",
          language: sorted[0]?.language || "en",
          visits: entry.bookings.filter((booking) => VISITED.has(booking.status)).length,
          cancellations: entry.bookings.filter((booking) => booking.status === "cancelled").length,
          noShows: entry.bookings.filter((booking) => booking.status === "no_show").length,
          restrictions: [...restrictions.values()],
          rooms: [
            ...new Set(
              entry.bookings.flatMap((booking) => (booking.operationalData?.rooms || []).filter(Boolean)),
            ),
          ],
          lastVisit:
            entry.bookings
              .filter((booking) => VISITED.has(booking.status))
              .map((booking) => booking.date)
              .sort()
              .pop() || null,
          duplicates: (byPhone.get(digitsOf(phone)) || []).filter((key) => key !== entry.key),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bookings]);

  const needle = String(query || "").toLowerCase();
  const shown = directory.filter(
    (guest) => !needle || `${guest.name} ${guest.phone} ${guest.email}`.toLowerCase().includes(needle),
  );
  const selected = shown.find((guest) => guest.name === selectedName) || shown[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "stretch", gap: isMobile ? 12 : 0 }}>
      <div
        style={{
          width: isMobile ? "100%" : 320,
          flexShrink: 0,
          borderRight: isMobile ? "none" : `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
          maxHeight: isMobile ? 260 : "70vh",
          overflow: "auto",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <span style={sectionLabel}>[Guest directory · {shown.length}]</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search name / phone / email"
            style={{ ...inputStyle, marginTop: 10 }}
          />
        </div>
        {shown.map((guest) => {
          const isSelected = selected && guest.key === selected.key;
          return (
            <button
              key={guest.key}
              type="button"
              onClick={() => onSelect(guest.name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                minHeight: 44,
                borderTop: "none",
                borderRight: "none",
                borderBottom: `1px solid ${tokens.ink[5]}`,
                borderLeft: `2px solid ${isSelected ? tokens.charcoal.default : "transparent"}`,
                background: isSelected ? tokens.tint.parchment : tokens.neutral[0],
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12, color: tokens.ink[0] }}>{guest.name}</span>
                {guest.duplicates.length > 0 && (
                  <span style={{ fontSize: 8, letterSpacing: "0.10em", color: tokens.signal.warn, fontWeight: 600 }}>DUP?</span>
                )}
              </div>
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: "0.08em",
                  color: guest.restrictions.length ? tokens.red.text : tokens.ink[3],
                  marginTop: 3,
                  textTransform: "uppercase",
                }}
              >
                {[
                  `${guest.visits} visit${guest.visits === 1 ? "" : "s"}`,
                  guest.lastVisit ? `last ${shortDay(guest.lastVisit)}` : "no visit yet",
                  ...guest.restrictions.slice(0, 2).map((note) => `[${note.toUpperCase()}]`),
                ].join(" · ")}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? 0 : 16 }}>
        {!selected && (
          <div style={{ textAlign: "center", padding: "80px 0", color: tokens.ink[3] }}>
            <div style={{ fontSize: 24, marginBottom: 12, letterSpacing: "0.10em", color: tokens.ink[4] }}>[ ]</div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase" }}>No guests match</div>
          </div>
        )}

        {selected && (
          <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: 16, maxWidth: 760 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 500, color: tokens.ink[0] }}>{selected.name}</span>
              {canEdit && (
                <button type="button" style={darkButton} onClick={() => onBookFor(selected)}>
                  [+] Book for guest
                </button>
              )}
            </div>

            {selected.duplicates.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: `1px solid ${tokens.signal.warn}`,
                  background: tokens.neutral[0],
                  padding: "8px 12px",
                  marginTop: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ width: 6, height: 6, background: tokens.signal.warn, flexShrink: 0 }} />
                <span style={{ fontSize: 9, letterSpacing: "0.08em", color: tokens.ink[2], flex: 1, minWidth: 180 }}>
                  Same telephone as{" "}
                  {selected.duplicates
                    .map((key) => (directory.find((guest) => guest.key === key) || {}).name || key)
                    .join(", ")}{" "}
                  — possible duplicate.
                </span>
                {onMergeGuests && canEdit && (
                  <button
                    type="button"
                    style={darkButton}
                    onClick={() =>
                      onMergeGuests({
                        keep: selected.name,
                        merge: selected.duplicates.map(
                          (key) => (directory.find((guest) => guest.key === key) || {}).name || key,
                        ),
                      })
                    }
                  >
                    Merge into this
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 1, background: tokens.ink[5], border: `1px solid ${tokens.ink[5]}`, marginTop: 14 }}>
              {[
                { k: "Mobile", v: selected.phone || "—" },
                { k: "Email", v: selected.email || "—" },
                { k: "Language", v: (selected.language || "en").toUpperCase() },
                { k: "Visits", v: String(selected.visits) },
                { k: "Last visit", v: selected.lastVisit ? shortDay(selected.lastVisit) : "—" },
                { k: "Cancellations", v: String(selected.cancellations) },
                { k: "No-shows", v: String(selected.noShows) },
                { k: "Hotel rooms", v: selected.rooms.length ? selected.rooms.join(", ") : "—" },
              ].map((spec) => (
                <div key={spec.k} style={{ background: tokens.neutral[0], padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3] }}>{spec.k}</div>
                  <div style={{ fontSize: 11, color: tokens.ink[0], marginTop: 3, fontWeight: 500 }}>{spec.v}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <span style={sectionLabel}>[Standing restrictions — union of all visits]</span>
              <div style={{ fontSize: 10, color: tokens.signal.alert, fontWeight: 600, letterSpacing: "0.06em", marginTop: 6 }}>
                {selected.restrictions.length
                  ? selected.restrictions.map((note) => `[${note.toUpperCase()}]`).join("  ")
                  : "No known restrictions"}
              </div>
            </div>

            <div style={{ marginTop: 14, borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 10 }}>
              <span style={sectionLabel}>[Reservation history]</span>
              <div style={{ fontSize: 9, letterSpacing: "0.04em", color: tokens.ink[2], lineHeight: 2.1, marginTop: 6 }}>
                {selected.sorted.map((booking) => (
                  <div key={booking.id}>
                    {shortDay(booking.date)} · {booking.time} · {booking.pax}p · {(booking.service || "").toUpperCase()} ·{" "}
                    {tableLabelOf(booking)} · {statusLabel(booking.status)}
                    {booking.source === "web" ? " · WEB" : ""}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 14, borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={sectionLabel}>[Archive history]</span>
                <button type="button" style={quietButton} onClick={() => setShowMemory((value) => !value)}>
                  {showMemory ? "Hide" : "Show"}
                </button>
              </div>
              {showMemory && (
                <Suspense fallback={<div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 8 }}>Loading history…</div>}>
                  <GuestMemory guestName={selected.name} />
                </Suspense>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
