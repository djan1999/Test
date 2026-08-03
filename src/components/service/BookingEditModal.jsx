import { useState } from "react";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const TAP = 44;

const micro = {
  fontFamily: FONT, fontSize: 8, letterSpacing: "0.16em",
  textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
};

const chip = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
  minHeight: TAP, padding: "6px 14px",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  borderRadius: 0, cursor: "pointer",
  background: on ? tokens.tint.parchment : tokens.neutral[0],
  color: on ? tokens.ink[0] : tokens.ink[3],
  fontWeight: on ? 700 : 400,
  touchAction: "manipulation",
});

const input = {
  fontFamily: FONT, fontSize: tokens.mobileInputSize, width: "100%", minHeight: TAP,
  padding: "9px 12px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
  background: tokens.neutral[0], color: tokens.ink[0],
  boxSizing: "border-box", WebkitAppearance: "none",
};

const stepper = {
  fontFamily: FONT, fontSize: 16, lineHeight: 1,
  width: TAP, height: TAP, flexShrink: 0,
  border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
  background: tokens.neutral[0], color: tokens.ink[0],
  cursor: "pointer", touchAction: "manipulation",
};

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ ...micro, marginBottom: 7 }}>{label}</div>
    {children}
  </div>
);

const MAX_COVERS = 14;

/**
 * EDIT RESERVATION — the booking behind the table, edited from the sheet.
 *
 * Everything else in the sheet writes the moment it is tapped, because it is
 * SERVICE work: a course is set, a drink is poured, and the receipt is a toast.
 * A booking is different — name, covers and sitting time are facts being
 * corrected together, and a half-applied correction (covers changed, name not
 * yet) is a worse state than the one it started from. So this panel batches:
 * CANCEL leaves the booking exactly as it was, SAVE commits it in one write.
 *
 * That single write also matters downstream. Covers resize the live table's
 * seats, and doing it once — instead of once per keystroke — is what keeps a
 * party of 2 corrected to 4 from rebuilding its seats three times on the way.
 */
export default function BookingEditModal({ table, onSave, onCancel }) {
  const [name, setName] = useState(table?.resName || "");
  const [time, setTime] = useState(table?.resTime || "");
  const [guests, setGuests] = useState(
    Number(table?._groupGuests || table?.guests) || 1,
  );
  const [menuType, setMenuType] = useState(String(table?.menuType || "").toLowerCase());
  const [lang, setLang] = useState(table?.lang || "en");
  const [guestType, setGuestType] = useState(table?.guestType || "");
  const [birthday, setBirthday] = useState(!!table?.birthday);
  const [rooms, setRooms] = useState(
    Array.isArray(table?.rooms) && table.rooms.length
      ? table.rooms.filter(Boolean)
      : (table?.room ? [table.room] : []),
  );
  const [saving, setSaving] = useState(false);

  useModalEscape(onCancel, true);

  const startGuests = Number(table?._groupGuests || table?.guests) || 0;
  const coversChanged = guests !== startGuests;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const cleanRooms = guestType === "hotel" ? rooms.filter(Boolean) : [];
    const result = await onSave({
      resName: name.trim(),
      resTime: time.trim(),
      guests,
      menuType,
      lang,
      guestType,
      room: cleanRooms[0] || "",
      rooms: cleanRooms,
      birthday,
    });
    // A refused write leaves the panel open with the operator's edit intact —
    // the usual refusal is a bad connection, and the next move is to tap SAVE
    // again, not to retype the whole booking.
    if (result?.ok === false) setSaving(false);
  };

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
        aria-label="Edit reservation"
        data-booking-edit=""
        onClick={e => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
          maxWidth: 420, width: "100%", maxHeight: "86vh",
          display: "flex", flexDirection: "column", fontFamily: FONT,
        }}
      >
        <div style={{ padding: "16px 16px 10px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <div style={{ ...micro, marginBottom: 6 }}>[EDIT RESERVATION]</div>
          <div style={{ fontSize: 11, color: tokens.ink[1], lineHeight: 1.5 }}>
            Nothing changes until you save.
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: 16 }}>
          <Field label="GUEST NAME">
            <input
              autoFocus
              value={name}
              aria-label="Guest name"
              placeholder="name on the booking"
              onChange={e => setName(e.target.value)}
              style={input}
            />
          </Field>

          <Field label="COVERS">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button" aria-label="One cover fewer" style={stepper}
                onClick={() => setGuests(g => Math.max(1, g - 1))}
              >−</button>
              <span
                data-covers=""
                style={{ fontSize: 20, color: tokens.ink[0], minWidth: 28, textAlign: "center" }}
              >{guests}</span>
              <button
                type="button" aria-label="One cover more" style={stepper}
                onClick={() => setGuests(g => Math.min(MAX_COVERS, g + 1))}
              >+</button>
            </div>
            {coversChanged && (
              <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.5, marginTop: 8 }}>
                Saving resizes the table from {startGuests} to {guests}. What each
                position already holds is kept; extra positions come in blank, and a
                restriction pinned to a position that goes away resurfaces unassigned.
              </div>
            )}
          </Field>

          <Field label="SITTING">
            <input
              value={time}
              aria-label="Booked time"
              placeholder="19:00"
              inputMode="numeric"
              onChange={e => setTime(e.target.value)}
              style={input}
            />
          </Field>

          <Field label="MENU">
            <div style={{ display: "flex", gap: 6 }}>
              {[["long", "LONG"], ["short", "SHORT"]].map(([v, l]) => (
                <button key={v} type="button" style={chip(menuType === v)}
                  onClick={() => setMenuType(m => (m === v ? "" : v))}
                >{l}</button>
              ))}
            </div>
          </Field>

          <Field label="LANGUAGE">
            <div style={{ display: "flex", gap: 6 }}>
              {[["en", "EN"], ["si", "SLO"]].map(([v, l]) => (
                <button key={v} type="button" style={chip(lang === v)}
                  onClick={() => setLang(v)}
                >{l}</button>
              ))}
            </div>
          </Field>

          <Field label="GUEST TYPE">
            <div style={{ display: "flex", gap: 6 }}>
              {[["", "REGULAR"], ["hotel", "HOTEL"]].map(([v, l]) => (
                <button key={v || "regular"} type="button" style={chip(guestType === v)}
                  onClick={() => { setGuestType(v); if (v !== "hotel") setRooms([]); }}
                >{l}</button>
              ))}
            </div>
            {guestType === "hotel" && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...micro, marginBottom: 7 }}>ROOM</div>
                <input
                  value={rooms.join(", ")}
                  aria-label="Hotel room number"
                  placeholder="room no."
                  onChange={e => setRooms(e.target.value.split(",").map(s => s.trim()))}
                  style={input}
                />
              </div>
            )}
          </Field>

          <Field label="CELEBRATION">
            <button type="button" style={chip(birthday)}
              aria-pressed={birthday}
              onClick={() => setBirthday(b => !b)}
            >[CAKE]</button>
          </Field>
        </div>

        <div style={{
          padding: 12, borderTop: `1px solid ${tokens.ink[4]}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              minHeight: TAP, padding: "8px 20px", border: `1px solid ${tokens.ink[4]}`,
              borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2],
            }}
          >CANCEL</button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              minHeight: TAP, padding: "8px 24px",
              border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
              cursor: saving ? "default" : "pointer",
              background: tokens.charcoal.default, color: tokens.neutral[0],
              fontWeight: 700, opacity: saving ? 0.5 : 1,
            }}
          >{saving ? "SAVING…" : "SAVE"}</button>
        </div>
      </div>
    </div>
  );
}
