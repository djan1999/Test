import { useState } from "react";
import { tokens } from "../../styles/tokens.js";

export default function BevEditRow({ emoji, label, items, onUpdate }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onUpdate([...(items || []), { name: v }]);
    setDraft("");
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: tokens.font, fontSize: 8, letterSpacing: 1.5, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {(items || []).map((item, i) => (
          <span key={i} style={{ fontFamily: tokens.font, fontSize: 10, padding: "6px 6px 6px 8px", borderRadius: 0, border: `1px solid ${tokens.neutral[200]}`, background: tokens.neutral[50], display: "flex", alignItems: "center", gap: 4 }}>
            {emoji} {item.name}
            <button onClick={() => onUpdate((items || []).filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: tokens.text.disabled, fontSize: 13, padding: 0, lineHeight: 1, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", flexShrink: 0 }}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="add…"
          style={{ fontFamily: tokens.font, fontSize: 10, padding: "9px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, outline: "none", width: 120 }}
        />
        {draft.trim() && (
          <button onClick={add} style={{ fontFamily: tokens.font, fontSize: 9, padding: "9px 8px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.tint.parchment, color: tokens.text.body, touchAction: "manipulation" }}>add</button>
        )}
      </div>
    </div>
  );
}
