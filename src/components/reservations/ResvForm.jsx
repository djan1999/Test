import { useState } from "react";
import { RESTRICTIONS, RESTRICTION_GROUPS } from "../../constants/dietary.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, circleButton } from "../../styles/mixins.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";

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

const courseKeyOf = (course) => course.course_key || course.menu?.name || course.position || "";
const courseLabelOf = (course) => course.menu?.name || course.course_key || `Course ${course.position ?? ""}`;

function sanitizeKitchenCourseNotes(map) {
  if (!map || typeof map !== "object") return {};
  const out = {};
  Object.entries(map).forEach(([key, entry]) => {
    if (!entry || typeof entry !== "object") return;
    const name = String(entry.name || "").trim();
    const note = String(entry.note || "").trim();
    const presets = {};
    if (entry.presets && typeof entry.presets === "object") {
      Object.entries(entry.presets).forEach(([label, count]) => {
        const n = Number(count) || 0;
        if (n > 0) presets[label] = n;
      });
    }
    const hasPresets = Object.keys(presets).length > 0;
    if (!name && !note && !hasPresets) return;
    const clean = {};
    if (name) clean.name = name;
    if (note) clean.note = note;
    if (hasPresets) clean.presets = presets;
    out[key] = clean;
  });
  return out;
}

export default function ResvForm({ initial, tables, reservations, excludeId, onSave, onCancel, menuCourses = [], courseQuickNotes = {} }) {
  const isMobile = useIsMobile(560);
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
  const [rooms, setRooms] = useState(
    Array.isArray(initial?.data?.rooms) && initial.data.rooms.length
      ? initial.data.rooms.filter(Boolean)
      : (initial?.data?.room ? [initial.data.room] : [])
  );
  const [birthday, setBirthday] = useState(!!initial?.data?.birthday);
  const [cakeNote, setCakeNote] = useState(initial?.data?.cakeNote || "");
  const [restrictions, setRestrictions] = useState(initial?.data?.restrictions || []);
  const [notes, setNotes] = useState(initial?.data?.notes || "");
  const [kitchenCourseNotes, setKitchenCourseNotes] = useState(initial?.data?.kitchenCourseNotes || {});
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
    const sortedRooms = guestType === "hotel" ? [...rooms].sort((a, b) => String(a).localeCompare(String(b))) : [];
    const data = {
      resName: name, resTime: time, menuType, lang, guests, guestType,
      room: sortedRooms[0] || "",
      rooms: sortedRooms,
      birthday, cakeNote: birthday ? cakeNote : "", restrictions, notes,
      tableGroup: sortedGroup,
      courseOverrides: initial?.data?.courseOverrides || {},
      kitchenCourseNotes: sanitizeKitchenCourseNotes(kitchenCourseNotes),
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
                  borderColor: isSel ? tokens.charcoal.default : conflict ? tokens.ink[4] : tokens.ink[4],
                  borderRadius: 0,
                  background: isSel ? tokens.tint.parchment : conflict ? tokens.neutral[50] : tokens.neutral[0],
                  color: isSel ? tokens.ink[1] : conflict ? tokens.ink[4] : tokens.ink[2],
                  cursor: conflict ? "not-allowed" : "pointer",
                }}
              >
                T{String(tid).padStart(2, "0")}
              </button>
            );
          })}
        </div>
        {tableIds.length === 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 4 }}>Select at least one table</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Name</div>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
        </div>
        <div>
          <div style={fieldLabel}>Sitting</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? `repeat(${SITTING_TIMES.length}, 1fr)` : "repeat(2, 1fr)", gap: 5 }}>
            {SITTING_TIMES.map((t) => (
              <button key={t} onClick={() => setTime(t === time ? "" : t)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 0.5, padding: "10px 0",
                border: "1px solid", borderColor: time === t ? tokens.charcoal.default : tokens.ink[4],
                borderRadius: 0, cursor: "pointer",
                background: time === t ? tokens.tint.parchment : tokens.neutral[0],
                color: time === t ? tokens.ink[1] : tokens.ink[3],
              }}>{t}</button>
            ))}
          </div>
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
        {guestType === "hotel" ? (
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
        {restrictions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {restrictions.map((r, i) => {
              const def = RESTRICTIONS.find((x) => x.key === r.note);
              const label = def ? `${def.emoji} ${def.label}` : r.note;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, borderRadius: 0 }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text }}>{label}</span>
                  <button onClick={() => setRestrictions((rs) => rs.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: tokens.red.border, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", flexShrink: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menuCourses.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>Kitchen course notes</div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginBottom: 8, lineHeight: 1.4 }}>
            Rename a course for this table, leave an ad-hoc note, or click a preset chip to stack a 1×/2× modifier on the kitchen ticket.
          </div>
          {menuCourses.map((c) => {
            const key = courseKeyOf(c);
            if (!key) return null;
            const entry = kitchenCourseNotes[key] || {};
            const presets = entry.presets || {};
            const chips = courseQuickNotes[key] || [];
            const label = courseLabelOf(c);
            const hasAny = entry.name || entry.note || Object.keys(presets).length > 0;
            const updateEntry = (patch) => {
              setKitchenCourseNotes((prev) => {
                const current = prev[key] || {};
                const next = { ...current, ...patch };
                if (!next.name) delete next.name;
                if (!next.note) delete next.note;
                if (next.presets && Object.keys(next.presets).length === 0) delete next.presets;
                const out = { ...prev };
                if (!next.name && !next.note && !next.presets) delete out[key];
                else out[key] = next;
                return out;
              });
            };
            const bumpPreset = (text) => {
              const current = entry.presets || {};
              updateEntry({ presets: { ...current, [text]: (current[text] || 0) + 1 } });
            };
            const clearPreset = (text) => {
              const current = { ...(entry.presets || {}) };
              delete current[text];
              updateEntry({ presets: current });
            };
            const clearAll = () => {
              setKitchenCourseNotes((prev) => {
                const out = { ...prev };
                delete out[key];
                return out;
              });
            };
            return (
              <div key={key} style={{
                border: `1px solid ${hasAny ? tokens.red.border : tokens.ink[4]}`, borderRadius: 0,
                padding: "8px 10px", marginBottom: 6, background: hasAny ? tokens.red.bg : tokens.neutral[0],
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.ink[1], letterSpacing: 0.4 }}>{label}</span>
                  {hasAny && (
                    <button onClick={clearAll} style={{
                      fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: "4px 8px",
                      border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.red.text, touchAction: "manipulation",
                    }}>Clear</button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 6, marginBottom: chips.length > 0 ? 8 : 0 }}>
                  <input
                    value={entry.name || ""}
                    onChange={(e) => updateEntry({ name: e.target.value })}
                    placeholder={`Rename "${label}"…`}
                    style={{ ...baseInp, fontSize: 10, padding: "7px 8px" }}
                  />
                  <input
                    value={entry.note || ""}
                    onChange={(e) => updateEntry({ note: e.target.value })}
                    placeholder="Note (e.g. allergic to mustard)"
                    style={{ ...baseInp, fontSize: 10, padding: "7px 8px" }}
                  />
                </div>
                {chips.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {chips.map((chip) => {
                      const count = presets[chip] || 0;
                      const active = count > 0;
                      return (
                        <button
                          key={chip}
                          onClick={() => bumpPreset(chip)}
                          onContextMenu={(e) => { e.preventDefault(); if (active) clearPreset(chip); }}
                          title={active ? "Click to add another, right-click to clear" : "Click to apply"}
                          style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "6px 9px",
                            border: `1px solid ${active ? tokens.red.border : tokens.neutral[200]}`,
                            borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                            background: active ? tokens.red.bg : tokens.neutral[50],
                            color: active ? tokens.red.text : tokens.text.muted,
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {active && <span style={{ marginRight: 4, fontWeight: 700 }}>{count}×</span>}
                          {chip}
                          {active && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); clearPreset(chip); }}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); clearPreset(chip); } }}
                              aria-label={`Clear ${chip}`}
                              style={{ marginLeft: 4, color: tokens.red.border, cursor: "pointer", fontSize: 12, lineHeight: 1, touchAction: "manipulation", display: "inline-block" }}
                            >×</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
