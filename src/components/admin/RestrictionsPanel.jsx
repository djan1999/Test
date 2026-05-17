import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT, baseInp, saveBtn, dangerBtn, primaryBtn } from "./adminStyles.js";
import { RESTRICTION_GROUPS } from "../../constants/dietary.js";

const GROUP_OPTIONS = Object.entries(RESTRICTION_GROUPS);

const slug = (str) => String(str || "").trim().toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

function uniqueKey(base, taken) {
  let candidate = base || "restriction";
  let i = 2;
  while (taken.has(candidate)) candidate = `${base}_${i++}`;
  return candidate;
}

export default function RestrictionsPanel({ restrictions = [], onSave }) {
  const [draft, setDraft] = useState(() => restrictions.map(r => ({ ...r })));
  const [status, setStatus] = useState("idle");
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const [newGroup, setNewGroup] = useState("dietary");

  useEffect(() => {
    setDraft(restrictions.map(r => ({ ...r })));
  }, [restrictions]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(restrictions), [draft, restrictions]);

  const updateRow = (idx, field, value) => {
    setDraft(d => d.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    setStatus("idle");
  };

  const removeRow = (idx) => {
    setDraft(d => d.filter((_, i) => i !== idx));
    setStatus("idle");
  };

  const addRow = () => {
    const label = newLabel.trim();
    if (!label) return;
    const taken = new Set(draft.map(r => r.key));
    const key = uniqueKey(slug(label), taken);
    setDraft(d => [...d, { key, label, emoji: newEmoji.trim(), group: newGroup }]);
    setNewLabel(""); setNewEmoji(""); setNewGroup("dietary");
    setStatus("idle");
  };

  const save = async () => {
    setStatus("saving");
    const result = await onSave(draft);
    if (result?.ok === false) { setStatus("error"); return; }
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  const grouped = useMemo(() => {
    const buckets = new Map(GROUP_OPTIONS.map(([k]) => [k, []]));
    draft.forEach((r, idx) => {
      const bucket = buckets.get(r.group) || buckets.get("other");
      bucket.push({ row: r, idx });
    });
    return buckets;
  }, [draft]);

  const labelStyle = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 4 };
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };
  const subHeader = { fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.charcoal.default, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 };

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], background: tokens.ink.bg, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
        Add, rename, or remove the dietary restrictions staff can apply to reservations.
        Removing a restriction is allowed — existing reservations that still reference it will display the raw key on tickets.
      </div>

      {GROUP_OPTIONS.map(([groupKey, groupLabel]) => {
        const rows = grouped.get(groupKey) || [];
        return (
          <div key={groupKey} style={{ marginBottom: 18 }}>
            <div style={subHeader}>{groupLabel}</div>
            {rows.length === 0 && (
              <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], fontStyle: "italic", padding: "8px 0" }}>
                No restrictions in this group.
              </div>
            )}
            {rows.map(({ row, idx }) => (
              <div key={row.key} style={{ display: "grid", gridTemplateColumns: "70px 1fr 140px 90px 80px", gap: 8, alignItems: "end", marginBottom: 6 }}>
                <div>
                  <div style={labelStyle}>Emoji</div>
                  <input value={row.emoji || ""} onChange={(e) => updateRow(idx, "emoji", e.target.value)} style={inpSm} />
                </div>
                <div>
                  <div style={labelStyle}>Label</div>
                  <input value={row.label || ""} onChange={(e) => updateRow(idx, "label", e.target.value)} style={inpSm} />
                </div>
                <div>
                  <div style={labelStyle}>Group</div>
                  <select value={row.group || "other"} onChange={(e) => updateRow(idx, "group", e.target.value)} style={inpSm}>
                    {GROUP_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>Key</div>
                  <input value={row.key} readOnly style={{ ...inpSm, background: tokens.ink.bg, color: tokens.ink[3] }} />
                </div>
                <button onClick={() => removeRow(idx)} style={dangerBtn}>REMOVE</button>
              </div>
            ))}
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 12, marginTop: 8 }}>
        <div style={subHeader}>Add restriction</div>
        <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 140px 110px", gap: 8, alignItems: "end" }}>
          <div>
            <div style={labelStyle}>Emoji</div>
            <input value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)} placeholder="🥗" style={inpSm} />
          </div>
          <div>
            <div style={labelStyle}>Label</div>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Pregnant" style={inpSm} />
          </div>
          <div>
            <div style={labelStyle}>Group</div>
            <select value={newGroup} onChange={(e) => setNewGroup(e.target.value)} style={inpSm}>
              {GROUP_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <button onClick={addRow} disabled={!newLabel.trim()} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 10, opacity: newLabel.trim() ? 1 : 0.4 }}>
            + ADD
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={save} disabled={!dirty || status === "saving"} style={{ ...saveBtn(status), opacity: dirty ? 1 : 0.5 }}>
          {status === "saving" ? "SAVING…" : status === "saved" ? "SAVED ✓" : status === "error" ? "ERROR" : "SAVE"}
        </button>
      </div>
    </div>
  );
}
