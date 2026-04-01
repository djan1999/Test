import { useState } from "react";
import { FONT, baseInp } from "./adminStyles.js";

// ── QuickAccessPanel — configure which drinks appear in Quick Access buttons ──
export default function QuickAccessPanel({
  quickAccessItems = [],
  onUpdateQuickAccess,
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newSearchKey, setNewSearchKey] = useState("");
  const [newType, setNewType] = useState("wine");

  const addItem = () => {
    if (!newLabel.trim()) return;
    const item = {
      id: Date.now(),
      label: newLabel.trim(),
      searchKey: newSearchKey.trim() || newLabel.trim(),
      type: newType,
      enabled: true,
    };
    onUpdateQuickAccess([...quickAccessItems, item]);
    setNewLabel("");
    setNewSearchKey("");
  };

  const toggleItem = (id) => {
    onUpdateQuickAccess(quickAccessItems.map(i =>
      i.id === id ? { ...i, enabled: !i.enabled } : i
    ));
  };

  const removeItem = (id) => {
    onUpdateQuickAccess(quickAccessItems.filter(i => i.id !== id));
  };

  const moveItem = (id, dir) => {
    const idx = quickAccessItems.findIndex(i => i.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= quickAccessItems.length) return;
    const reordered = [...quickAccessItems];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    onUpdateQuickAccess(reordered);
  };

  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 16 }}>
        QUICK ACCESS — configure aperitif/drink buttons shown during service
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {quickAccessItems.map((item, idx) => (
          <div key={item.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px",
            border: `1px solid ${item.enabled ? "#e8e8e8" : "#f0f0f0"}`,
            borderRadius: 4,
            background: item.enabled ? "#fff" : "#fafafa",
            opacity: item.enabled ? 1 : 0.6,
          }}>
            <button
              onClick={() => toggleItem(item.id)}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1,
                padding: "4px 10px", border: "1px solid",
                borderColor: item.enabled ? "#4a9a6a" : "#ddd",
                borderRadius: 2, cursor: "pointer",
                background: item.enabled ? "#f0faf0" : "#fff",
                color: item.enabled ? "#4a9a6a" : "#aaa",
                flexShrink: 0,
              }}
            >{item.enabled ? "ON" : "OFF"}</button>

            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{item.label}</div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#999" }}>
                search: {item.searchKey} | {item.type}
              </div>
            </div>

            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>
                ▲</button>
              <button onClick={() => moveItem(item.id, 1)} disabled={idx === quickAccessItems.length - 1}
                style={{ background: "none", border: "none", cursor: idx === quickAccessItems.length - 1 ? "default" : "pointer", color: idx === quickAccessItems.length - 1 ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>
                ▼</button>
            </div>

            <button onClick={() => removeItem(item.id)} style={{
              background: "none", border: "1px solid #ffcccc", borderRadius: 2,
              color: "#e07070", cursor: "pointer", fontFamily: FONT, fontSize: 9,
              letterSpacing: 1, padding: "4px 8px", flexShrink: 0,
            }}>REMOVE</button>
          </div>
        ))}

        {quickAccessItems.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "30px 0" }}>
            No quick access items configured
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 18 }}>
        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", textTransform: "uppercase", marginBottom: 8 }}>Add item</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>BUTTON LABEL</div>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="e.g. Slapšak" style={inpSm} />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>SEARCH KEY</div>
            <input value={newSearchKey} onChange={e => setNewSearchKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="defaults to label" style={inpSm} />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>TYPE</div>
            <select value={newType} onChange={e => setNewType(e.target.value)}
              style={{ ...inpSm, cursor: "pointer" }}>
              <option value="wine">Wine</option>
              <option value="cocktail">Cocktail</option>
              <option value="spirit">Spirit</option>
              <option value="beer">Beer</option>
            </select>
          </div>
        </div>
        <button onClick={addItem} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
          background: "#1a1a1a", color: "#fff",
        }}>+ ADD ITEM</button>
      </div>
    </div>
  );
}
