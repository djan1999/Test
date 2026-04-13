import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { outlineBtn } from "../../styles/uiChrome.js";

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
      <div style={{ fontFamily: tokens.font, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {(items || []).map((item, i) => (
          <span key={i} style={{ fontFamily: tokens.font, fontSize: 10, padding: "2px 6px 2px 8px", borderRadius: 2, border: "1px solid #e0e0e0", background: "#fafafa", display: "flex", alignItems: "center", gap: 4 }}>
            {emoji} {item.name}
            <button onClick={() => onUpdate((items || []).filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="add…"
          style={{ fontFamily: tokens.font, fontSize: 10, padding: "3px 8px", border: "1px solid #e8e8e8", borderRadius: 2, outline: "none", width: 120 }}
        />
        {draft.trim() && (
          <button onClick={add} style={{ fontFamily: tokens.font, fontSize: 9, padding: "3px 8px", borderRadius: 2, cursor: "pointer", ...outlineBtn }}>add</button>
        )}
      </div>
    </div>
  );
}
