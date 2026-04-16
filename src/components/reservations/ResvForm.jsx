import { useState } from "react";
import { RESTRICTIONS, RESTRICTION_GROUPS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, circleButton } from "../../styles/mixins.js";

const FONT = tokens.font;
const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };
const circBtnSm = { ...circleButton };

const DEFAULT_ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const parseSittingTimes = () => {
  const raw = String(import.meta.env.VITE_DEFAULT_SITTING_TIMES || "18:00,18:30,19:00,19:15")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : ["18:00", "18:30", "19:00", "19:15"];
};

const SITTING_TIMES = parseSittingTimes();
const ROOM_OPTIONS = DEFAULT_ROOM_OPTIONS.length ? DEFAULT_ROOM_OPTIONS : ["01", "11", "12", "21", "22", "23"];

export default function ResvForm({ initial, tables, reservations, excludeId, onSave, onCancel }) {
  const [tableIds, setTableIds] = useState(
    initial?.data?.tableGroup?.length > 1 ? initial.data.tableGroup.map(Number)
      : initial?.table_id ? [Number(initial.table_id)]
      : []
  );
  const [name, setName] = useState(initial?.data?.resName || "");
  const [time, setTime] = useState(initial?.data?.resTime || "");
  const [menuType, setMenuType] = useState(initial?.data?.menuType || "");
  const [lang, setLang] = useState(initial?.data?.lang || "en");
  const [guests, setGuests] = useState(initial?.data?.guests || 2);
  const [guestType, setGuestType] = useState(initial?.data?.guestType || "");
  const [room, setRoom] = useState(initial?.data?.room || "");
  const [birthday, setBirthday] = useState(!!initial?.data?.birthday);
  const [cakeNote, setCakeNote] = useState(initial?.data?.cakeNote || "");
  const [restrictions, setRestrictions] = useState(initial?.data?.restrictions || []);
  const [notes, setNotes] = useState(initial?.data?.notes || "");
  const [saving, setSaving] = useState(false);

  const sortedGroup = [...tableIds].sort((a, b) => a - b);
  const primaryId = sortedGroup[0] ?? null;

  const isConflict = (tid) => reservations.some((r) =>
    r.id !== excludeId &&
    r.date === initial?.date &&
    (r.table_id === tid || (r.data?.tableGroup || []).map(Number).includes(tid)) &&
    !tableIds.includes(tid)
  );

  const handleSave = async () => {
    if (!primaryId) return;
    setSaving(true);
    const data = {
      resName: name, resTime: time, menuType, lang, guests, guestType,
      room: guestType === "hotel" ? room : "", birthday, cakeNote: birthday ? cakeNote : "", restrictions, notes,
      tableGroup: sortedGroup,
      courseOverrides: initial?.data?.courseOverrides || {},
      kitchenCourseNotes: initial?.data?.kitchenCourseNotes || {},
    };
    await onSave({ id: initial?.id, date: initial?.date, table_id: primaryId, data });
    setSaving(false);
  };

  return (
    <div style={{ background: "#fafafa", border: "1px solid #e8e8e8", borderRadius: 0, padding: "14px 14px 18px", margin: "4px 0 8px", fontFamily: FONT }}>
      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>
          Table
          {tableIds.length > 1 && <span style={{ color: "#aaa", fontWeight: 400, marginLeft: 6 }}>T{sortedGroup.join("-")} · combined</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((tid) => {
            const isSel = tableIds.includes(tid);
            const conflict = isConflict(tid);
            return (
              <button
                key={tid}
                onClick={() => {
                  if (conflict) return;
                  setTableIds((prev) => prev.includes(tid) ? (prev.length > 1 ? prev.filter((x) => x !== tid) : prev) : [...prev, tid]);
                }}
                style={{
                  fontFamily: FONT, fontSize: 11, padding: "9px 0",
                  border: "1px solid",
                  borderColor: isSel ? "#c8a96e" : conflict ? "#f0d0b0" : "#e0e0e0",
                  borderRadius: 0,
                  background: isSel ? "#e8dcc8" : conflict ? "#fff8f2" : "#fff",
                  color: isSel ? "#6a5030" : conflict ? "#c07840" : "#555",
                  cursor: conflict ? "not-allowed" : "pointer",
                }}
              >
                T{String(tid).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        {tableIds.length === 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: "#e06060", marginTop: 4 }}>Select at least one table</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Name</div>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
        </div>
        <div>
          <div style={fieldLabel}>Sitting</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 5 }}>
            {SITTING_TIMES.map((t) => (
              <button key={t} onClick={() => setTime(t === time ? "" : t)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 0.5, padding: "8px 0",
                border: "1px solid", borderColor: time === t ? "#c8a96e" : "#e8e8e8",
                borderRadius: 0, cursor: "pointer",
                background: time === t ? "#e8dcc8" : "#fff",
                color: time === t ? "#6a5030" : "#666",
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Menu</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["long", "Long"], ["short", "Short"]].map(([v, l]) => (
              <button key={v} onClick={() => setMenuType(menuType === v ? "" : v)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: menuType === v ? "#c8a96e" : "#e8e8e8",
                borderRadius: 0, cursor: "pointer",
                background: menuType === v ? "#e8dcc8" : "#fff",
                color: menuType === v ? "#6a5030" : "#666",
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
                border: "1px solid", borderColor: lang === v ? "#c8a96e" : "#e8e8e8",
                borderRadius: 0, cursor: "pointer",
                background: lang === v ? "#e8dcc8" : "#fff",
                color: lang === v ? "#6a5030" : "#666",
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Guests</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setGuests((g) => Math.max(1, g - 1))} style={circBtnSm}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 15, minWidth: 22, textAlign: "center", color: "#1a1a1a" }}>{guests}</span>
            <button onClick={() => setGuests((g) => Math.min(14, g + 1))} style={circBtnSm}>+</button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
        <div>
          <div style={fieldLabel}>Guest type</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["", "Regular"], ["hotel", "Hotel"], ["outside", "Outside"]].map(([v, l]) => (
              <button key={v || "r"} onClick={() => { setGuestType(v); if (v !== "hotel") setRoom(""); }} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: guestType === v ? "#c8a96e" : "#e8e8e8",
                borderRadius: 0, cursor: "pointer",
                background: guestType === v ? "#e8dcc8" : "#fff",
                color: guestType === v ? "#6a5030" : "#666",
              }}>{l}</button>
            ))}
          </div>
        </div>
        {guestType === "hotel" ? (
          <div>
            <div style={fieldLabel}>Room</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {ROOM_OPTIONS.map((r) => (
                <button key={r} onClick={() => setRoom((x) => x === r ? "" : r)} style={{
                  fontFamily: FONT, fontSize: 11, padding: "7px 10px",
                  border: "1px solid", borderColor: room === r ? "#c8a06e" : "#e8e8e8",
                  borderRadius: 0, cursor: "pointer",
                  background: room === r ? "#fdf6ec" : "#fff",
                  color: room === r ? "#a07040" : "#555",
                }}>{r}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22, flexWrap: "wrap" }}>
            <input type="checkbox" id={`resvbd-${initial?.id || "new"}`} checked={birthday} onChange={(e) => setBirthday(e.target.checked)} style={{ width: 14, height: 14, cursor: "pointer" }} />
            <label htmlFor={`resvbd-${initial?.id || "new"}`} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>Cake</label>
            {birthday && <input value={cakeNote} onChange={(e) => setCakeNote(e.target.value)} placeholder="occasion (e.g. Mrs Bday)" style={{ ...baseInp, flex: 1, minWidth: 100, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "4px 8px" }} />}
          </div>
        )}
      </div>
      {guestType === "hotel" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input type="checkbox" id={`resvbd2-${initial?.id || "new"}`} checked={birthday} onChange={(e) => setBirthday(e.target.checked)} style={{ width: 14, height: 14, cursor: "pointer" }} />
          <label htmlFor={`resvbd2-${initial?.id || "new"}`} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>Cake</label>
          {birthday && <input value={cakeNote} onChange={(e) => setCakeNote(e.target.value)} placeholder="occasion (e.g. Mrs Bday)" style={{ ...baseInp, flex: 1, minWidth: 100, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "4px 8px" }} />}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Dietary restrictions</div>
        {Object.entries(RESTRICTION_GROUPS).map(([group, groupLabel]) => {
          const items = RESTRICTIONS.filter((r) => r.group === group);
          return (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>{groupLabel}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {items.map((opt) => {
                  const cnt = restrictions.filter((r) => r.note === opt.key).length;
                  return (
                    <button key={opt.key} onClick={() => setRestrictions((rs) => [...rs, { pos: null, note: opt.key }])} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "5px 9px",
                      borderRadius: 0, cursor: "pointer",
                      border: `1px solid ${cnt > 0 ? "#e09090" : "#e8e8e8"}`,
                      background: cnt > 0 ? "#fef0f0" : "#fafafa",
                      color: cnt > 0 ? "#b04040" : "#888",
                      fontWeight: cnt > 0 ? 600 : 400,
                    }}>
                      {opt.emoji} {opt.label}
                      {cnt > 0 && <span style={{ marginLeft: 4, background: "#e09090", color: "#fff", borderRadius: 0, fontSize: 8, padding: "1px 4px" }}>{cnt}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {restrictions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {restrictions.map((r, i) => {
              const def = RESTRICTIONS.find((x) => x.key === r.note);
              const label = def ? `${def.emoji} ${def.label}` : r.note;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#fef0f0", border: "1px solid #e09090", borderRadius: 0 }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: "#b04040" }}>{label}</span>
                  <button onClick={() => setRestrictions((rs) => rs.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "#e09090", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
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
        <button onClick={onCancel} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: "1px solid #e0e0e0", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#666" }}>CANCEL</button>
        <button onClick={handleSave} disabled={!primaryId || saving} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 20px", border: "1px solid #b8975e", borderRadius: 0, cursor: "pointer", background: "#c8a96e", color: "#fff", fontWeight: 600, opacity: (!primaryId || saving) ? 0.5 : 1 }}>
          {saving ? "SAVING…" : "SAVE"}
        </button>
      </div>
    </div>
  );
}
