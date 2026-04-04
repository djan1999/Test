import { useState, useRef, useEffect } from "react";
import { FONT, baseInp } from "./adminStyles.js";

function catalogForType(type, wines, cocktails, spirits, beers) {
  if (type === "wine")     return (wines     || []).map(w => w.name || w.producer || "").filter(Boolean);
  if (type === "cocktail") return (cocktails || []).map(c => c.name || "").filter(Boolean);
  if (type === "spirit")   return (spirits   || []).map(s => s.name || "").filter(Boolean);
  if (type === "beer")     return (beers     || []).map(b => b.name || "").filter(Boolean);
  return [];
}

function SearchKeyInput({ value, onChange, type, wines, cocktails, spirits, beers, placeholder, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const q = value.toLowerCase();
  const matches = q.length > 0
    ? catalogForType(type, wines, cocktails, spirits, beers)
        .filter(name => name.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || "defaults to label"}
        style={style}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
          background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3,
          boxShadow: "0 4px 12px rgba(0,0,0,0.10)", maxHeight: 220, overflowY: "auto",
        }}>
          {matches.map(name => (
            <div
              key={name}
              onMouseDown={e => { e.preventDefault(); onChange(name); setOpen(false); }}
              style={{
                fontFamily: FONT, fontSize: 10, padding: "7px 10px", cursor: "pointer",
                borderBottom: "1px solid #f4f4f4", color: "#222",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#f7f7ff"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >{name}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── QuickAccessPanel — configure which drinks appear in Quick Access buttons ──
export default function QuickAccessPanel({
  quickAccessItems = [],
  onUpdateQuickAccess,
  wines = [], cocktails = [], spirits = [], beers = [],
}) {
  const [newLabel,     setNewLabel]     = useState("");
  const [newSearchKey, setNewSearchKey] = useState("");
  const [newType,      setNewType]      = useState("wine");
  const [editingId,    setEditingId]    = useState(null);
  const [editLabel,    setEditLabel]    = useState("");
  const [editKey,      setEditKey]      = useState("");
  const [editType,     setEditType]     = useState("wine");

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
    setNewLabel(""); setNewSearchKey("");
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditKey(item.searchKey || item.label);
    setEditType(item.type || "wine");
  };

  const saveEdit = () => {
    onUpdateQuickAccess(quickAccessItems.map(i =>
      i.id === editingId
        ? { ...i, label: editLabel.trim() || i.label, searchKey: editKey.trim() || editLabel.trim() || i.label, type: editType }
        : i
    ));
    setEditingId(null);
  };

  const toggleItem = (id) => {
    onUpdateQuickAccess(quickAccessItems.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i));
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
  const selSm = { ...inpSm, cursor: "pointer" };

  const TypeSelect = ({ value, onChange }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={selSm}>
      <option value="wine">Wine</option>
      <option value="cocktail">Cocktail</option>
      <option value="spirit">Spirit</option>
      <option value="beer">Beer</option>
    </select>
  );

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 16 }}>
        QUICK ACCESS — configure aperitif/drink buttons shown during service
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {quickAccessItems.map((item, idx) => (
          <div key={item.id} style={{
            border: `1px solid ${editingId === item.id ? "#c8c6e8" : item.enabled ? "#e8e8e8" : "#f0f0f0"}`,
            borderRadius: 4, background: item.enabled ? "#fff" : "#fafafa",
            opacity: item.enabled ? 1 : 0.6,
          }}>
            {/* Row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
              <button onClick={() => toggleItem(item.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1,
                padding: "4px 10px", border: "1px solid",
                borderColor: item.enabled ? "#4a9a6a" : "#ddd",
                borderRadius: 2, cursor: "pointer",
                background: item.enabled ? "#f0faf0" : "#fff",
                color: item.enabled ? "#4a9a6a" : "#aaa", flexShrink: 0,
              }}>{item.enabled ? "ON" : "OFF"}</button>

              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{item.label}</div>
                <div style={{ fontFamily: FONT, fontSize: 9, color: "#999" }}>
                  search: {item.searchKey} | {item.type}
                </div>
              </div>

              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                  style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▲</button>
                <button onClick={() => moveItem(item.id, 1)} disabled={idx === quickAccessItems.length - 1}
                  style={{ background: "none", border: "none", cursor: idx === quickAccessItems.length - 1 ? "default" : "pointer", color: idx === quickAccessItems.length - 1 ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▼</button>
              </div>

              <button
                onClick={() => editingId === item.id ? saveEdit() : startEdit(item)}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                  border: `1px solid ${editingId === item.id ? "#4b4b88" : "#ddd"}`,
                  borderRadius: 2, cursor: "pointer",
                  background: editingId === item.id ? "#4b4b88" : "#fff",
                  color: editingId === item.id ? "#fff" : "#888", flexShrink: 0,
                }}>{editingId === item.id ? "SAVE" : "EDIT"}</button>

              <button onClick={() => removeItem(item.id)} style={{
                background: "none", border: "1px solid #ffcccc", borderRadius: 2,
                color: "#e07070", cursor: "pointer", fontFamily: FONT, fontSize: 9,
                letterSpacing: 1, padding: "4px 8px", flexShrink: 0,
              }}>REMOVE</button>
            </div>

            {/* Inline editor */}
            {editingId === item.id && (
              <div style={{ padding: "0 14px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8 }}>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: "#999", letterSpacing: 1, marginBottom: 3 }}>BUTTON LABEL</div>
                  <input value={editLabel} onChange={e => setEditLabel(e.target.value)} style={inpSm} />
                </div>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: "#999", letterSpacing: 1, marginBottom: 3 }}>SEARCH KEY</div>
                  <SearchKeyInput
                    value={editKey} onChange={setEditKey} type={editType}
                    wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                    style={inpSm}
                  />
                </div>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: "#999", letterSpacing: 1, marginBottom: 3 }}>TYPE</div>
                  <TypeSelect value={editType} onChange={setEditType} />
                </div>
              </div>
            )}
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
            <SearchKeyInput
              value={newSearchKey} onChange={setNewSearchKey} type={newType}
              wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
              placeholder="defaults to label" style={inpSm}
            />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>TYPE</div>
            <TypeSelect value={newType} onChange={setNewType} />
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
