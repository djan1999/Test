import { useState } from "react";
import { RESTRICTIONS, RESTRICTION_GROUPS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, circleButton } from "../../styles/mixins.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { reservationTableIds } from "../../utils/tableHelpers.js";
import GuestMemory from "./GuestMemory.jsx";

const FONT = tokens.font;
const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };
const circBtnSm = { ...circleButton };

const DEFAULT_ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const parseSittingTimes = (envKey, fallback) => {
  const raw = String(import.meta.env[envKey] || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : fallback.split(",").map(s => s.trim());
};

const DINNER_TIMES = parseSittingTimes("VITE_DEFAULT_SITTING_TIMES", "18:00,18:30,19:00,19:15");
const LUNCH_TIMES  = parseSittingTimes("VITE_DEFAULT_LUNCH_TIMES",   "12:00,12:30,13:00");
// Legacy alias — keeps any external references to SITTING_TIMES intact
const SITTING_TIMES = DINNER_TIMES;
const ROOM_OPTIONS = DEFAULT_ROOM_OPTIONS.length ? DEFAULT_ROOM_OPTIONS : ["01", "11", "12", "21", "22", "23"];

export default function ResvForm({ initial, tables, reservations, excludeId, onSave, onCancel, onResolveConflict, onSwapReservations }) {
  const isMobile = useIsMobile(560);
  const [tableIds, setTableIds] = useState(
    initial?.data?.tableGroup?.length > 1 ? initial.data.tableGroup.map(Number)
      : initial?.table_id ? [Number(initial.table_id)]
      : []
  );
  const [conflictPrompt, setConflictPrompt] = useState(null); // { tid, conflictResv }
  const [conflictResolveMode, setConflictResolveMode] = useState(false); // showing table picker for displaced resv
  const [name, setName] = useState(initial?.data?.resName || "");
  const [time, setTime] = useState(initial?.data?.resTime || "");
  const [serviceSession, setServiceSession] = useState(initial?.data?.service_session || "dinner");
  const [menuType, setMenuType] = useState(initial?.data?.menuType || "");
  const [lang, setLang] = useState(initial?.data?.lang || "en");
  const [guests, setGuests] = useState(initial?.data?.guests || 2);
  const [guestType, setGuestType] = useState(initial?.data?.guestType || "");
  const [rooms, setRooms] = useState(
    Array.isArray(initial?.data?.rooms) && initial.data.rooms.length
      ? initial.data.rooms.filter(Boolean)
      : (initial?.data?.room ? [initial.data.room] : [])
  );
  const [birthday, setBirthday] = useState(!!initial?.data?.birthday);
  const [cakeNote, setCakeNote] = useState(initial?.data?.cakeNote || "");
  const [restrictions, setRestrictions] = useState(initial?.data?.restrictions || []);
  const [notes, setNotes] = useState(initial?.data?.notes || "");
  const [customLabel, setCustomLabel] = useState("");
  const [customDetail, setCustomDetail] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);

  const sortedGroup = [...tableIds].sort((a, b) => a - b);
  const primaryId = sortedGroup[0] ?? null;

  const findConflict = (tid) => reservations.find((r) => {
    if (r.id === excludeId) return false;
    if (r.date !== initial?.date) return false;
    if (r.data?.clearedFromBoard) return false; // cleared off the board → table is free
    if (tableIds.includes(tid)) return false;
    // A dinner reservation never blocks a lunch table and vice versa.
    const existingSession = r.data?.service_session || "dinner";
    if (existingSession !== serviceSession) return false;
    return reservationTableIds(r.data, r.table_id).includes(Number(tid));
  }) || null;
  const isConflict = (tid) => !!findConflict(tid);

  const handleSessionChange = (s) => {
    setServiceSession(s);
    // Lunch always defaults to short menu; dinner clears the auto-selection only
    // if the current value was auto-set from a previous lunch selection.
    if (s === "lunch" && !menuType) setMenuType("short");
  };

  const handleSave = async () => {
    if (!primaryId) return;
    setSaving(true);
    const sortedRooms = guestType === "hotel" ? [...rooms].sort((a, b) => String(a).localeCompare(String(b))) : [];
    const data = {
      service_session: serviceSession, resName: name, resTime: time, menuType, lang, guests, guestType,
      room: sortedRooms[0] || "",
      rooms: sortedRooms,
      birthday, cakeNote: birthday ? cakeNote : "", restrictions, notes,
      tableGroup: sortedGroup,
      courseOverrides: initial?.data?.courseOverrides || {},
      kitchenCourseNotes: initial?.data?.kitchenCourseNotes || {},
    };
    await onSave({ id: initial?.id, date: initial?.date, table_id: primaryId, data });
    setSaving(false);
  };

  return (
    <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "14px 14px 18px", margin: "4px 0 8px", fontFamily: FONT }}>
      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>
          Table
          {tableIds.length > 1 && <span style={{ color: tokens.text.muted, fontWeight: 400, marginLeft: 6 }}>T{sortedGroup.join("-")} · combined</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((tid) => {
            const isSel = tableIds.includes(tid);
            const conflictResv = findConflict(tid);
            const conflict = !!conflictResv;
            return (
              <button
                key={tid}
                onClick={() => {
                  if (conflict) {
                    setConflictPrompt({ tid, conflictResv });
                    setConflictResolveMode(false);
                    return;
                  }
                  setTableIds((prev) => prev.includes(tid) ? (prev.length > 1 ? prev.filter((x) => x !== tid) : prev) : [...prev, tid]);
                }}
                style={{
                  fontFamily: FONT, fontSize: 11, padding: "9px 0",
                  border: "1px solid",
                  borderColor: isSel ? tokens.charcoal.default : conflict ? tokens.red.border : tokens.ink[4],
                  borderRadius: 0,
                  background: isSel ? tokens.tint.parchment : conflict ? tokens.red.bg : tokens.neutral[0],
                  color: isSel ? tokens.ink[1] : conflict ? tokens.red.text : tokens.ink[2],
                  cursor: "pointer",
                }}
              >
                T{String(tid).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        {tableIds.length === 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 4 }}>Select at least one table</div>}
      </div>

      {conflictPrompt && (() => {
        const { tid, conflictResv } = conflictPrompt;
        const cd = conflictResv.data || {};
        // Swap is only safe when BOTH reservations are single-table. If the
        // partner spans a group, a plain table_id swap would leave its
        // data.tableGroup pointing at the old table — corrupting the group.
        const partnerIsGroup = Array.isArray(cd.tableGroup) && cd.tableGroup.length > 1;
        const canSwap = tableIds.length === 1 && !!excludeId
          && typeof onSwapReservations === "function" && !partnerIsGroup;
        const otherTables = Array.from({ length: 10 }, (_, i) => i + 1)
          // Can't park the displaced resv on the table being freed for *this*
          // resv (the user wants tid for the current edit) or on a table this
          // form is already using.
          .filter(t => t !== tid && !tableIds.includes(t))
          .map(t => {
            const owner = reservations.find(r => {
              if (r.id === excludeId) return false;
              if (r.id === conflictResv.id) return false;
              if (r.date !== initial?.date) return false;
              const sess = r.data?.service_session || "dinner";
              if (sess !== serviceSession) return false;
              return reservationTableIds(r.data, r.table_id).includes(Number(t));
            });
            return { id: t, owner };
          });
        return (
          <div
            onClick={() => { setConflictPrompt(null); setConflictResolveMode(false); }}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 300, padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
                maxWidth: 460, width: "100%", padding: 18, fontFamily: FONT,
              }}
            >
              <div style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.red.text, marginBottom: 6 }}>
                [TABLE OCCUPIED]
              </div>
              <div style={{ fontSize: "12px", color: tokens.ink[0], marginBottom: 12, lineHeight: 1.5 }}>
                <strong>T{String(tid).padStart(2, "0")}</strong> is held by <strong>{cd.resName || "(unnamed)"}</strong>
                {cd.resTime ? ` at ${cd.resTime}` : ""}{cd.guests ? ` · ${cd.guests} pax` : ""}.
              </div>
              {!conflictResolveMode ? (
                <>
                  <div style={{ fontSize: 11, color: tokens.ink[2], marginBottom: 14, lineHeight: 1.4 }}>
                    {canSwap
                      ? <>Swap tables with this reservation, or move it to a different free table.</>
                      : <>To take this table, move the existing reservation to another table first.</>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => { setConflictPrompt(null); }}
                      style={{
                        fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                        padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                        cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
                      }}
                    >CANCEL</button>
                    {canSwap && (
                      <button
                        onClick={async () => {
                          await onSwapReservations(excludeId, conflictResv.id);
                          setTableIds([tid]);
                          setConflictPrompt(null);
                        }}
                        style={{
                          fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                          padding: "8px 16px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                          cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[0], fontWeight: 600,
                        }}
                      >SWAP T{String(tableIds[0]).padStart(2, "0")} ↔ T{String(tid).padStart(2, "0")}</button>
                    )}
                    <button
                      onClick={() => setConflictResolveMode(true)}
                      disabled={typeof onResolveConflict !== "function"}
                      style={{
                        fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                        padding: "8px 16px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                        cursor: typeof onResolveConflict === "function" ? "pointer" : "not-allowed",
                        background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 600,
                        opacity: typeof onResolveConflict === "function" ? 1 : 0.5,
                      }}
                    >MOVE {cd.resName ? cd.resName.split(/\s+/)[0].toUpperCase() : "IT"} TO…</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: tokens.ink[2], marginBottom: 10, lineHeight: 1.4 }}>
                    Pick a free table for <strong>{cd.resName || "(unnamed)"}</strong>:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5, marginBottom: 12 }}>
                    {otherTables.map(({ id, owner }) => {
                      const disabled = !!owner;
                      return (
                        <button
                          key={id}
                          onClick={async () => {
                            if (disabled) return;
                            await onResolveConflict(conflictResv.id, id);
                            // Claim the freed table for this booking. A single-table
                            // booking MOVES onto it (replace) — same as the SWAP path —
                            // instead of becoming a phantom combined "T2-9". A genuine
                            // multi-table booking still extends (adds the table).
                            setTableIds((prev) =>
                              prev.length <= 1 ? [tid] : (prev.includes(tid) ? prev : [...prev, tid]));
                            setConflictPrompt(null);
                            setConflictResolveMode(false);
                          }}
                          disabled={disabled}
                          style={{
                            fontFamily: FONT, fontSize: 11, padding: "10px 0",
                            border: `1px solid ${disabled ? tokens.red.border : tokens.ink[4]}`,
                            borderRadius: 0,
                            background: disabled ? tokens.red.bg : tokens.neutral[0],
                            color: disabled ? tokens.red.text : tokens.ink[1],
                            cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>T{String(id).padStart(2, "0")}</span>
                          {owner && (
                            <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7 }}>
                              {(owner.data?.resName || "held").slice(0, 8)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      onClick={() => setConflictResolveMode(false)}
                      style={{
                        fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                        padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                        cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
                      }}
                    >BACK</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>Service</div>
        <div style={{ display: "flex", gap: 5 }}>
          {[["lunch", "Lunch"], ["dinner", "Dinner"]].map(([v, l]) => (
            <button key={v} onClick={() => handleSessionChange(v)} style={{
              fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
              border: "1px solid", borderColor: serviceSession === v ? tokens.charcoal.default : tokens.ink[4],
              borderRadius: 0, cursor: "pointer",
              background: serviceSession === v ? tokens.tint.parchment : tokens.neutral[0],
              color: serviceSession === v ? tokens.ink[1] : tokens.ink[3],
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Name</div>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
          <GuestMemory name={name} />
        </div>
        <div>
          <div style={fieldLabel}>Sitting</div>
          {(() => {
            const sessionTimes = serviceSession === "lunch" ? LUNCH_TIMES : DINNER_TIMES;
            return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? `repeat(${sessionTimes.length}, 1fr)` : "repeat(2, 1fr)", gap: 5 }}>
            {sessionTimes.map((t) => (
              <button key={t} onClick={() => setTime(t === time ? "" : t)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 0.5, padding: "10px 0",
                border: "1px solid", borderColor: time === t ? tokens.charcoal.default : tokens.ink[4],
                borderRadius: 0, cursor: "pointer",
                background: time === t ? tokens.tint.parchment : tokens.neutral[0],
                color: time === t ? tokens.ink[1] : tokens.ink[3],
              }}>{t}</button>
            ))}
          </div>
            );
          })()}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr auto", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Menu</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["long", "Long"], ["short", "Short"]].map(([v, l]) => (
              <button key={v} onClick={() => setMenuType(menuType === v ? "" : v)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: menuType === v ? tokens.charcoal.default : tokens.ink[4],
                borderRadius: 0, cursor: "pointer",
                background: menuType === v ? tokens.tint.parchment : tokens.neutral[0],
                color: menuType === v ? tokens.ink[1] : tokens.ink[3],
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Language</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["en", "EN"], ["si", "SLO"]].map(([v, l]) => (
              <button key={v} onClick={() => setLang(v)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: lang === v ? tokens.charcoal.default : tokens.ink[4],
                borderRadius: 0, cursor: "pointer",
                background: lang === v ? tokens.tint.parchment : tokens.neutral[0],
                color: lang === v ? tokens.ink[1] : tokens.ink[3],
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Guests</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setGuests((g) => Math.max(1, g - 1))} style={circBtnSm}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 15, minWidth: 22, textAlign: "center", color: tokens.ink[0] }}>{guests}</span>
            <button onClick={() => setGuests((g) => Math.min(14, g + 1))} style={circBtnSm}>+</button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
        <div>
          <div style={fieldLabel}>Guest type</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["", "Regular"], ["hotel", "Hotel"]].map(([v, l]) => (
              <button key={v || "r"} onClick={() => { setGuestType(v); if (v !== "hotel") setRooms([]); }} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: guestType === v ? tokens.charcoal.default : tokens.ink[4],
                borderRadius: 0, cursor: "pointer",
                background: guestType === v ? tokens.tint.parchment : tokens.neutral[0],
                color: guestType === v ? tokens.ink[1] : tokens.ink[3],
              }}>{l}</button>
            ))}
          </div>
        </div>
        {guestType === "hotel" && (
          <div>
            <div style={fieldLabel}>
              Rooms
              {rooms.length > 0 && <span style={{ color: tokens.text.muted, fontWeight: 400, marginLeft: 6 }}>#{[...rooms].sort((a, b) => String(a).localeCompare(String(b))).join(", ")}</span>}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {ROOM_OPTIONS.map((r) => {
                const isSel = rooms.includes(r);
                return (
                  <button key={r} onClick={() => setRooms((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])} style={{
                    fontFamily: FONT, fontSize: 11, padding: "10px 10px", touchAction: "manipulation",
                    border: "1px solid", borderColor: isSel ? tokens.charcoal.default : tokens.ink[4],
                    borderRadius: 0, cursor: "pointer",
                    background: isSel ? tokens.tint.parchment : tokens.neutral[0],
                    color: tokens.ink[1],
                    fontWeight: isSel ? 600 : 400,
                  }}>{r}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input type="checkbox" id={`resvbd-${initial?.id || "new"}`} checked={birthday} onChange={(e) => setBirthday(e.target.checked)} style={{ width: 14, height: 14, cursor: "pointer" }} />
        <label htmlFor={`resvbd-${initial?.id || "new"}`} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>Cake</label>
        {birthday && <input value={cakeNote} onChange={(e) => setCakeNote(e.target.value)} placeholder="occasion (e.g. Mrs Bday)" style={{ ...baseInp, flex: 1, minWidth: 100, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "4px 8px" }} />}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Dietary restrictions</div>
        {Object.entries(RESTRICTION_GROUPS).map(([group, groupLabel]) => {
          const items = RESTRICTIONS.filter((r) => r.group === group);
          return (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[4], textTransform: "uppercase", marginBottom: 5 }}>{groupLabel}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {items.map((opt) => {
                  const cnt = restrictions.filter((r) => r.note === opt.key).length;
                  return (
                    <button key={opt.key} onClick={() => setRestrictions((rs) => [...rs, { pos: null, note: opt.key }])} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "10px 9px",
                      borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                      border: `1px solid ${cnt > 0 ? tokens.red.border : tokens.neutral[200]}`,
                      background: cnt > 0 ? tokens.red.bg : tokens.neutral[50],
                      color: cnt > 0 ? tokens.red.text : tokens.text.muted,
                      fontWeight: cnt > 0 ? 600 : 400,
                    }}>
                      {opt.emoji} {opt.label}
                      {cnt > 0 && <span style={{ marginLeft: 4, background: tokens.red.border, color: tokens.neutral[0], borderRadius: 0, fontSize: 8, padding: "1px 4px" }}>{cnt}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[4], textTransform: "uppercase", marginBottom: 5 }}>Custom</div>
          {!showCustomInput ? (
            <button onClick={() => setShowCustomInput(true)} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "10px 12px",
              borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
              border: `1px dashed ${tokens.ink[4]}`,
              background: tokens.neutral[0],
              color: tokens.text.muted,
            }}>
              + Custom restriction
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Short label (e.g. NO RABBIT)"
                style={{ ...baseInp, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "6px 8px" }}
              />
              <input
                type="text"
                value={customDetail}
                onChange={(e) => setCustomDetail(e.target.value)}
                placeholder="Details (optional, e.g. lard, spread, stocks ok)"
                style={{ ...baseInp, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "6px 8px" }}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button onClick={() => { setShowCustomInput(false); setCustomLabel(""); setCustomDetail(""); }} style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "6px 12px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                  cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
                }}>Cancel</button>
                <button onClick={() => {
                  const label = customLabel.trim();
                  if (!label) return;
                  setRestrictions((rs) => [...rs, { pos: null, note: label, detail: customDetail.trim() }]);
                  setCustomLabel(""); setCustomDetail(""); setShowCustomInput(false);
                }} disabled={!customLabel.trim()} style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "6px 14px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                  cursor: customLabel.trim() ? "pointer" : "not-allowed",
                  background: tokens.charcoal.default, color: tokens.neutral[0],
                  fontWeight: 600, opacity: customLabel.trim() ? 1 : 0.5,
                }}>Add</button>
              </div>
            </div>
          )}
        </div>
        {restrictions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
            {restrictions.map((r, i) => {
              const def = RESTRICTIONS.find((x) => x.key === r.note);
              const label = def ? `${def.emoji} ${def.label}` : r.note;
              const detail = !def && r.detail ? r.detail : "";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, borderRadius: 0 }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text }}>
                    {label}
                    {detail && <span style={{ opacity: 0.75, marginLeft: 4 }}>({detail})</span>}
                  </span>
                  <button onClick={() => setRestrictions((rs) => rs.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: tokens.red.border, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", flexShrink: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="VIP, pace, special requests…" style={{ ...baseInp, minHeight: 56, resize: "vertical", lineHeight: 1.5 }} />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3] }}>CANCEL</button>
        <button onClick={handleSave} disabled={!primaryId || saving} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 20px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 600, opacity: (!primaryId || saving) ? 0.5 : 1 }}>
          {saving ? "SAVING…" : "SAVE"}
        </button>
      </div>
    </div>
  );
}
