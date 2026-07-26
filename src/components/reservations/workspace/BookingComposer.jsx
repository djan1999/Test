// BookingComposer — taking a booking, on the telephone, with a guest waiting.
//
// The order of the screen IS the order of the conversation: which service,
// what time, how many, who. Everything after that is optional, and the footer
// says so, because a host who is being talked at should never be hunting for
// the one field that unblocks SAVE.
//
// The availability panel never hides a table. A "no" is shown with the reason
// beside it — "T04 · NOVAK 19:00" — because that is the sentence a host can say
// out loud, and because a manager is allowed to overrule it by tapping anyway.
// The verdicts come from the one availability engine (tableAvailabilityAt), not
// from a second copy of the occupancy rule living in this file.
//
// It edits and emits the legacy row shape, exactly as ResvForm did, so the
// workspace's save path is unchanged.

import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import { RESTRICTIONS, RESTRICTION_GROUPS } from "../../../constants/dietary.js";
import {
  generateSlots,
  resolveServicesForDate,
  suggestTables,
  tableAvailabilityAt,
} from "../../../domain/reservations/availability.js";
import { tableLabelToId } from "../../../domain/reservations/bookingAdapter.js";
import { FONT, chipStyle, dayLabel, inputStyle } from "./shared.js";

const SERVICES = [["lunch", "Lunch"], ["dinner", "Dinner"]];
const MENUS = [["long", "Long"], ["short", "Short"]];
const LANGS = [["en", "EN"], ["si", "SLO"]];
const GUEST_TYPES = [["regular", "Regular"], ["hotel", "Hotel"]];
const GROUP_ORDER = ["dietary", "allergy", "other"];

const label = {
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: tokens.ink[3],
  marginBottom: 6,
};
const subLabel = { ...label, fontSize: 8, letterSpacing: "0.12em", marginBottom: 5 };
const row = { display: "flex", gap: 6, flexWrap: "wrap" };
const field = { marginBottom: 16 };

/** The reason a host reads off the panel, in the restaurant's words. */
function reasonText(verdict) {
  if (verdict.ok) return `${verdict.seats} seats`;
  if (verdict.reason === "pick_time") return "Pick a time first";
  if (verdict.reason === "too_small") return `Seats ${verdict.seats}`;
  if (verdict.takenBy) return `${verdict.takenBy.name} ${verdict.takenBy.time}`.trim();
  return "Taken";
}

export default function BookingComposer({
  initial,
  existing = null,
  config,
  weeklyServices = [],
  calendarRules = [],
  bookings = [],
  onSave,
  onCancel,
}) {
  const data = initial?.data || {};
  const date = initial?.date;

  const [service, setService] = useState(data.service_session || "dinner");
  const [time, setTime] = useState(data.resTime || "");
  const [pax, setPax] = useState(Number(data.guests) || 2);
  const [name, setName] = useState(data.resName || "");
  const [phone, setPhone] = useState(data.phone || "");
  const [email, setEmail] = useState(data.email || "");
  const [menuType, setMenuType] = useState(data.menuType || "long");
  const [lang, setLang] = useState(data.lang || "en");
  const [guestType, setGuestType] = useState(data.guestType || "regular");
  const [occasion, setOccasion] = useState(data.occasion || "");
  const [vip, setVip] = useState(Boolean(data.vip));
  const [status, setStatus] = useState(data.booking_status || "confirmed");
  const [notes, setNotes] = useState(data.notes || "");
  const [restrictions, setRestrictions] = useState(
    Array.isArray(data.restrictions) ? data.restrictions : [],
  );
  const [combine, setCombine] = useState((data.tableGroup || []).length > 1);
  const [tableGroup, setTableGroup] = useState(
    (data.tableGroup || []).map((value) => `T${String(tableLabelToId(value)).padStart(2, "0")}`),
  );

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const seatings = useMemo(() => {
    const open = resolveServicesForDate(date, weeklyServices, calendarRules);
    const match = open.find((entry) => entry.service === service);
    return match ? generateSlots(match.first, match.last, match.interval) : [];
  }, [calendarRules, date, service, weeklyServices]);

  const verdicts = useMemo(
    () => tableAvailabilityAt({
      date, time, pax, bookings, config, excludeId: existing?.id || null,
    }),
    [bookings, config, date, existing, pax, time],
  );

  const toggleRestriction = (key) => setRestrictions((list) => (
    list.some((entry) => entry.note === key)
      ? list.filter((entry) => entry.note !== key)
      : [...list, { pos: null, note: key }]
  ));

  const toggleTable = (id) => setTableGroup((group) => {
    if (group.includes(id)) return group.filter((item) => item !== id);
    return combine ? [...group, id] : [id];
  });

  const autoAssign = () => {
    const suggestion = suggestTables({
      date, time, pax, bookings, config, excludeId: existing?.id || null,
    });
    if (suggestion) {
      setTableGroup(suggestion.tables);
      setCombine(suggestion.combined);
    }
  };

  const save = () => {
    onSave?.({
      ...initial,
      date,
      table_id: tableLabelToId(tableGroup[0]) ?? null,
      data: {
        ...data,
        reservation_v2: true,
        booking_status: status,
        service_session: service,
        resTime: time,
        guests: Number(pax) || 1,
        resName: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        menuType,
        lang,
        guestType,
        occasion,
        vip,
        notes,
        restrictions,
        tableGroup: tableGroup.map(tableLabelToId).filter(Boolean),
      },
    });
  };

  const canSave = Boolean(name.trim()) && Boolean(time) && Number(pax) > 0;
  const capPerSitting = Number(config?.pacing?.coversPerSlot) || null;

  const Toggle = ({ options, value, onChange }) => (
    <div style={row}>
      {options.map(([key, text]) => (
        <button key={key} type="button" style={chipStyle(value === key, { touch: true })} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, color: tokens.ink[1], background: tokens.neutral[0] }}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "14px 18px", borderBottom: `1px solid ${tokens.ink[4]}`,
      }}>
        <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[0] }}>
          [{existing ? "Edit reservation" : "New reservation"} — {dayLabel(date)}]
        </span>
        <button type="button" style={chipStyle(false, { touch: true })} onClick={onCancel}>✕ Esc</button>
      </header>

      <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap" }}>
        {/* ── The conversation, in order ─────────────────────────────────── */}
        <div style={{ flex: "1 1 420px", minWidth: 300, padding: "18px 20px", borderRight: `1px solid ${tokens.ink[4]}` }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div style={label}>Session</div>
              <Toggle options={SERVICES} value={service} onChange={setService} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={label}>
                Sitting{capPerSitting ? ` · cap ${capPerSitting}/sitting` : ""}
              </div>
              <div style={row}>
                {seatings.length === 0 && (
                  <span style={{ fontSize: 10, color: tokens.ink[3] }}>No {service} service on this day.</span>
                )}
                {seatings.map((slot) => (
                  <button key={slot} type="button" style={chipStyle(time === slot, { touch: true })} onClick={() => setTime(slot)}>
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", ...field }}>
            <div style={{ flex: "1 1 260px" }}>
              <div style={label}>Guest name</div>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest name…" style={inputStyle} />
            </div>
            <div>
              <div style={label}>Party size</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" style={chipStyle(false, { touch: true, pad: "8px 14px" })} onClick={() => setPax((n) => Math.max(1, n - 1))}>−</button>
                <span style={{ fontSize: 16, minWidth: 24, textAlign: "center" }}>{pax}</span>
                <button type="button" style={chipStyle(false, { touch: true, pad: "8px 14px" })} onClick={() => setPax((n) => n + 1)}>+</button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", ...field }}>
            <div style={{ flex: "1 1 200px" }}>
              <div style={label}>Mobile</div>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+386 …" style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <div style={label}>Email</div>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="optional" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", ...field }}>
            <div><div style={label}>Menu</div><Toggle options={MENUS} value={menuType} onChange={setMenuType} /></div>
            <div><div style={label}>Language</div><Toggle options={LANGS} value={lang} onChange={setLang} /></div>
            <div><div style={label}>Guest type</div><Toggle options={GUEST_TYPES} value={guestType} onChange={setGuestType} /></div>
            <div>
              <div style={label}>Tags · occasion</div>
              <div style={row}>
                <button type="button" style={chipStyle(vip, { touch: true })} onClick={() => setVip((on) => !on)}>VIP</button>
                <button
                  type="button"
                  style={chipStyle(occasion === "Cake", { touch: true })}
                  onClick={() => setOccasion((value) => (value === "Cake" ? "" : "Cake"))}
                >
                  Cake
                </button>
                <button
                  type="button"
                  style={chipStyle(true, { touch: true })}
                  onClick={() => setStatus((value) => (value === "confirmed" ? "pending" : "confirmed"))}
                >
                  Status: {status}
                </button>
              </div>
            </div>
          </div>

          <div style={field}>
            <div style={label}>Dietary restrictions</div>
            {GROUP_ORDER.map((group) => {
              const items = RESTRICTIONS.filter((entry) => entry.group === group);
              if (!items.length) return null;
              return (
                <div key={group} style={{ marginBottom: 10 }}>
                  <div style={subLabel}>{RESTRICTION_GROUPS[group]}</div>
                  <div style={row}>
                    {items.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        style={chipStyle(restrictions.some((r) => r.note === entry.key), { touch: true })}
                        onClick={() => toggleRestriction(entry.key)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div style={label}>Notes — staff / kitchen</div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="VIP, pace, window preference, guest-facing requests…"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </div>

        {/* ── Availability — nothing hidden, every no explained ───────────── */}
        <div style={{ flex: "0 1 340px", minWidth: 260, padding: "18px 20px" }}>
          <div style={label}>Availability — pick a sitting time</div>

          <div style={{ ...row, marginBottom: 12 }}>
            <button type="button" style={chipStyle(false, { touch: true })} onClick={autoAssign} disabled={!time}>
              Auto-assign best
            </button>
            <button type="button" style={chipStyle(combine, { touch: true })} onClick={() => setCombine((on) => !on)}>
              + Combine
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {verdicts.map((verdict) => {
              const picked = tableGroup.includes(verdict.id);
              return (
                <button
                  key={verdict.id}
                  type="button"
                  onClick={() => toggleTable(verdict.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    minHeight: 52,
                    fontFamily: FONT,
                    cursor: "pointer",
                    borderRadius: 0,
                    border: `1px solid ${picked ? tokens.ink[0] : verdict.ok ? tokens.ink[4] : tokens.red.border}`,
                    background: picked ? tokens.tint.parchment : verdict.ok ? tokens.neutral[0] : tokens.red.bg,
                    color: verdict.ok ? tokens.ink[1] : tokens.red.text,
                  }}
                >
                  <span style={{
                    display: "block", fontSize: 11, letterSpacing: "0.10em",
                    fontWeight: picked ? 600 : 500, color: verdict.ok ? tokens.ink[0] : tokens.red.text,
                  }}>
                    {verdict.id}
                  </span>
                  <span style={{
                    display: "block", marginTop: 3, fontSize: 8, letterSpacing: "0.08em",
                    textTransform: "uppercase", color: verdict.ok ? tokens.ink[3] : tokens.red.text,
                  }}>
                    {reasonText(verdict)}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[2] }}>
            Selected: {tableGroup.length ? tableGroup.join(" + ") : "–"}
          </div>
          <p style={{ marginTop: 8, fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: 1.7, color: tokens.ink[3] }}>
            Unavailable tables stay visible with the reason — tap one to override as manager.
          </p>
        </div>
      </div>

      <footer style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        padding: "12px 18px", borderTop: `1px solid ${tokens.ink[4]}`,
      }}>
        <span style={{ fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3] }}>
          Fast path: time → pax → name → auto-assign → save. Everything else is optional.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={chipStyle(false, { touch: true, pad: "10px 18px" })} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            style={{
              fontFamily: FONT, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
              padding: "10px 18px", minHeight: 34, borderRadius: 0, border: `1px solid ${tokens.ink[0]}`,
              background: canSave ? tokens.ink[0] : tokens.ink[4],
              color: canSave ? tokens.neutral[0] : tokens.ink[2],
              cursor: canSave ? "pointer" : "default",
            }}
          >
            Save booking
          </button>
        </div>
      </footer>
    </div>
  );
}
