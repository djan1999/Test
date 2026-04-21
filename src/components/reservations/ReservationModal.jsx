import { useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { RESTRICTIONS, RESTRICTION_GROUPS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, circleButton as mixinCircleButton } from "../../styles/mixins.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };
const circBtnSm = { ...mixinCircleButton };

const parseSittingTimes = () => {
  const raw = String(import.meta.env.VITE_DEFAULT_SITTING_TIMES || "18:00,18:30,19:00,19:15")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
  return raw.length ? raw : ["18:00", "18:30", "19:00", "19:15"];
};
const SITTING_TIMES = parseSittingTimes();
const DEFAULT_ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);
const ROOM_OPTIONS = DEFAULT_ROOM_OPTIONS.length ? DEFAULT_ROOM_OPTIONS : ["01", "11", "12", "21", "22", "23"];

export default function ReservationModal({ table, tables = [], onSave, onClose }) {
  const isMobile = useIsMobile(700);
  const [tableIds, setTableIds]   = useState(table.tableGroup?.length > 1 ? table.tableGroup : [table.id]);
  const [name, setName]           = useState(table.resName || "");
  const [time, setTime]           = useState(table.resTime || "");
  const [menuType, setMenuType]   = useState(table.menuType || "");
  const [guests, setGuests]       = useState(table.guests || 2);
  const [guestType, setGuestType] = useState(table.guestType || "");
  const [room, setRoom]           = useState(table.room || "");
  const [birthday, setBirthday]   = useState(table.birthday || false);
  const [restrictions, setRestrictions] = useState(table.restrictions || []);
  const [notes, setNotes]         = useState(table.notes || "");
  const [lang, setLang]           = useState(table.lang || "en");

  useModalEscape(onClose);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(4px)", zIndex: 500,
      display: "flex", alignItems: "flex-end",
      justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: tokens.neutral[0], borderTop: `1px solid ${tokens.neutral[200]}`,
        borderRadius: 0,
        padding: isMobile ? "18px 14px 24px" : "24px 20px 32px",
        paddingBottom: isMobile ? "calc(24px + env(safe-area-inset-bottom))" : 32,
        width: "100%", maxWidth: 520,
        maxHeight: "92dvh", overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.10)",
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 0, background: tokens.neutral[200], margin: "0 auto 20px" }} />

        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: tokens.text.muted, marginBottom: 16 }}>
          TABLE · RESERVATION
        </div>

        {/* Table picker — multi-select for combined tables */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={fieldLabel}>Table</div>
            {tableIds.length > 1 && (
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.secondary, letterSpacing: 1 }}>
                T{[...tableIds].sort((a,b)=>a-b).join("-")} · combined
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(5, 1fr)" : "repeat(5, 1fr)", gap: isMobile ? 5 : 6 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(tid => {
              const tObj     = tables.find(t => t.id === tid);
              const isActive = tObj?.active;
              const isBooked = tObj && (tObj.resName || tObj.resTime) && !table.tableGroup?.includes(tid) && tid !== table.id;
              const isSel    = tableIds.includes(tid);
              const toggle   = () => {
                if (isActive) return;
                setTableIds(prev =>
                  prev.includes(tid)
                    ? prev.length > 1 ? prev.filter(x => x !== tid) : prev  // keep at least one
                    : [...prev, tid]
                );
              };
              return (
                <button key={tid} onClick={toggle} disabled={isActive}
                  title={isActive ? "Table is currently seated" : isBooked ? `Reserved: ${tObj.resName || tObj.resTime}` : ""}
                  style={{
                    fontFamily: FONT, fontSize: 13, fontWeight: 500, letterSpacing: 1,
                    padding: "12px 0", border: "1px solid",
                    borderColor: isSel ? tokens.charcoal.default : isActive ? tokens.neutral[200] : isBooked ? tokens.neutral[300] : tokens.neutral[200],
                    borderRadius: 0, cursor: isActive ? "not-allowed" : "pointer",
                    background: isSel ? tokens.tint.parchment : isActive ? tokens.neutral[50] : isBooked ? tokens.neutral[50] : tokens.neutral[0],
                    color: isSel ? tokens.text.secondary : isActive ? tokens.text.disabled : isBooked ? tokens.text.muted : tokens.text.body,
                    transition: "all 0.1s",
                  }}>
                  T{String(tid).padStart(2, "0")}
                </button>
              );
            })}
          </div>
          {tableIds.length === 1 && (
            <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.muted, marginTop: 5, letterSpacing: 0.5 }}>
              Tap multiple tables to combine (e.g. T2-3)
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={fieldLabel}>Name</div>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
          </div>

          <div>
            <div style={fieldLabel}>Sitting</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {SITTING_TIMES.map(t => (
                <button key={t} onClick={() => setTime(t)} style={{
                  fontFamily: FONT, fontSize: 13, letterSpacing: 1,
                  padding: "14px 0", flex: 1, border: "1px solid",
                  borderColor: time === t ? tokens.charcoal.default : tokens.neutral[200],
                  borderRadius: 0, cursor: "pointer",
                  background: time === t ? tokens.tint.parchment : tokens.neutral[0],
                  color: time === t ? tokens.text.secondary : tokens.text.muted,
                  transition: "all 0.12s",
                }}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={fieldLabel}>Menu</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Long", "Short"].map(opt => (
                  <button key={opt} onClick={() => setMenuType(m => m === opt ? "" : opt)} style={{
                    fontFamily: FONT, fontSize: 10, letterSpacing: 2,
                    padding: "10px 24px", border: "1px solid",
                    borderColor: menuType === opt ? tokens.charcoal.default : tokens.neutral[200],
                    borderRadius: 0, cursor: "pointer",
                    background: menuType === opt ? tokens.tint.parchment : tokens.neutral[0],
                    color: menuType === opt ? tokens.text.secondary : tokens.text.muted,
                    textTransform: "uppercase",
                  }}>{opt}</button>
                ))}
              </div>
          </div>

          <div>
            <div style={fieldLabel}>Language</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{v:"en",l:"EN"},{v:"si",l:"SLO"}].map(opt => (
                <button key={opt.v} onClick={() => setLang(opt.v)} style={{
                  fontFamily: FONT, fontSize: 10, letterSpacing: 2,
                  padding: "10px 24px", border: "1px solid",
                  borderColor: lang === opt.v ? tokens.charcoal.default : tokens.neutral[200],
                  borderRadius: 0, cursor: "pointer",
                  background: lang === opt.v ? tokens.tint.parchment : tokens.neutral[0],
                  color: lang === opt.v ? tokens.text.secondary : tokens.text.muted,
                  textTransform: "uppercase",
                }}>{opt.l}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "120px 1fr", gap: 16, alignItems: "flex-start" }}>
            <div>
              <div style={fieldLabel}>Guests</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button onClick={() => setGuests(g => Math.max(1, g-1))} style={circBtnSm}>−</button>
                <span style={{ fontFamily: FONT, fontSize: 18, color: tokens.text.primary, minWidth: 20, textAlign: "center" }}>{guests}</span>
                <button onClick={() => setGuests(g => Math.min(14, g+1))} style={circBtnSm}>+</button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>Guest Type</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["hotel"].map(type => (
                  <button key={type} onClick={() => { setGuestType(t => t === type ? "" : type); setRoom(""); }} style={{
                    fontFamily: FONT, fontSize: 11, letterSpacing: 1,
                    padding: "12px 20px", minWidth: 120, border: "1px solid",
                    borderColor: guestType === type ? tokens.charcoal.default : tokens.neutral[200],
                    borderRadius: 0, cursor: "pointer",
                    background: guestType === type ? tokens.tint.parchment : tokens.neutral[0],
                    color: guestType === type ? tokens.text.secondary : tokens.text.body,
                    transition: "all 0.12s", textTransform: "uppercase",
                  }}>{type}</button>
                ))}
              </div>
              {guestType === "hotel" && (
                <div style={{ marginTop: 12 }}>
                  <div style={fieldLabel}>Room</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {ROOM_OPTIONS.map(r => (
                      <button key={r} onClick={() => setRoom(x => x === r ? "" : r)} style={{
                        fontFamily: FONT, fontSize: 13, fontWeight: 500, letterSpacing: 1,
                        padding: "12px 16px", border: "1px solid",
                        borderColor: room === r ? tokens.charcoal.default : tokens.neutral[200],
                        borderRadius: 0, cursor: "pointer",
                        background: room === r ? tokens.tint.parchment : tokens.neutral[0],
                        color: room === r ? tokens.text.secondary : tokens.text.body,
                        transition: "all 0.12s",
                      }}>{r}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${tokens.neutral[200]}` }} />

          <div>
            <div style={fieldLabel}>🎂 Birthday Cake</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[true,false].map(val => (
                <button key={String(val)} onClick={() => setBirthday(val)} style={{
                  fontFamily: FONT, fontSize: 12, letterSpacing: 1,
                  padding: "14px 0", flex: 1, border: "1px solid",
                  borderColor: birthday === val ? (val ? tokens.charcoal.default : tokens.neutral[200]) : tokens.neutral[200],
                  borderRadius: 0, cursor: "pointer",
                  background: birthday === val ? (val ? tokens.tint.parchment : tokens.neutral[50]) : tokens.neutral[0],
                  color: birthday === val ? (val ? tokens.text.secondary : tokens.text.primary) : tokens.text.secondary,
                  transition: "all 0.12s",
                }}>{val ? "YES" : "NO"}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...fieldLabel, marginBottom: 12 }}>⚠️ Restrictions</div>

            {/* Chip picker — each click adds one entry (multiple seats can share same restriction) */}
            {Object.entries(RESTRICTION_GROUPS).map(([group, groupLabel]) => {
              const groupItems = RESTRICTIONS.filter(r => r.group === group);
              return (
                <div key={group} style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 7 }}>{groupLabel}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {groupItems.map(opt => {
                      const count = restrictions.filter(r => r.note === opt.key).length;
                      const active = count > 0;
                      return (
                        <button key={opt.key}
                          onClick={() => setRestrictions(rs => [...rs, { pos: null, note: opt.key }])}
                          style={{
                            fontFamily: FONT, fontSize: 10, letterSpacing: 0.5,
                            padding: "10px 11px", borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                            border: `1px solid ${active ? tokens.red.border : tokens.neutral[200]}`,
                            background: active ? tokens.red.bg : tokens.neutral[50],
                            color: active ? tokens.red.text : tokens.text.muted,
                            fontWeight: active ? 600 : 400,
                            transition: "all 0.1s",
                            position: "relative",
                          }}>
                          {opt.emoji} {opt.label}
                          {count > 0 && (
                            <span style={{
                              marginLeft: 5,
                              background: tokens.red.border, color: tokens.neutral[0],
                              borderRadius: 0, fontSize: 9, fontWeight: 700,
                              padding: "1px 5px", verticalAlign: "middle",
                            }}>{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Active restrictions — just chips, seat assigned later in service */}
            {restrictions.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {restrictions.map((r, i) => {
                  const def = RESTRICTIONS.find(x => x.key === r.note);
                  const label = def ? `${def.emoji} ${def.label}` : r.note;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", background: tokens.red.bg,
                      border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                    }}>
                      <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.red.text, fontWeight: 500 }}>{label}</span>
                      <button onClick={() => setRestrictions(rs => rs.filter((_, idx) => idx !== i))}
                        style={{ background: "none", border: "none", color: tokens.red.border, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", flexShrink: 0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
            {restrictions.length > 0 && (
              <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.disabled, marginTop: 8, letterSpacing: 0.5 }}>
                Assign to seats when guests are seated
              </div>
            )}
          </div>

          <div>
            <div style={fieldLabel}>📝 Notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="VIP, pace, special requests…"
              style={{ ...baseInp, minHeight: 72, resize: "vertical", lineHeight: 1.5 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
          <button onClick={onClose} style={{
            flex: 1, fontFamily: FONT, fontSize: 12, letterSpacing: 2,
            padding: "14px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.body,
          }}>CANCEL</button>
          <button onClick={() => onSave({ tableIds, name, time, menuType, guests, guestType, room, birthday, restrictions, notes, lang })} style={{
            flex: 2, fontFamily: FONT, fontSize: 12, letterSpacing: 2,
            padding: "14px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary,
          }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}


// ── Table Card ────────────────────────────────────────────────────────────────
