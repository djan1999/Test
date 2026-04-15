import { useState, useRef, useEffect } from "react";
import { FONT, baseInp } from "./adminStyles.js";
import { fuzzy, fuzzyDrink } from "../../utils/search.js";

// ── WinePickerInput — mirrors the WineSearch in App.jsx ──────────────────────
function WinePickerInput({ value, onChange, type, wines, cocktails, spirits, beers, style }) {
  const [q, setQ]       = useState("");
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const list = type === "wine" ? wines : type === "cocktail" ? cocktails : type === "spirit" ? spirits : beers;
  const results = q.length > 0
    ? (type === "wine" ? fuzzy(q, wines, null) : fuzzyDrink(q, list)).slice(0, 8)
    : [];

  const selectItem = (item) => {
    // For wines: use the wine name as the searchKey (matches existing lookup logic)
    const key = type === "wine"
      ? (item.name || item.producer || "")
      : (item.name || "");
    onChange(key);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {value && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, color: "#4b4b88", background: "#f4f4fc", border: "1px solid #c8c6e8", borderRadius: 0, padding: "2px 6px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value}
          </span>
          <button onClick={() => onChange("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={value ? "search to replace…" : "search wines…"}
        style={style}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300,
          background: "#fff", border: "1px solid #e0e0e0", borderRadius: 0,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 260, overflowY: "auto",
        }}>
          {results.map((item, i) => (
            <div
              key={item.id ?? i}
              onMouseDown={e => { e.preventDefault(); selectItem(item); }}
              style={{ fontFamily: FONT, fontSize: 10, padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f4f4f4" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f7f7ff"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontWeight: 600, color: "#1a1a1a" }}>{item.name}</span>
              {item.producer && <span style={{ color: "#888" }}> · {item.producer}</span>}
              {item.vintage  && <span style={{ color: "#aaa" }}> · {item.vintage}</span>}
              {item.byGlass  && <span style={{ color: "#4a9a6a", marginLeft: 4, fontSize: 8 }}>BTG</span>}
            </div>
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

  const inpSm  = { ...baseInp, padding: "5px 8px", fontSize: 11 };
  const selSm  = { ...inpSm, cursor: "pointer" };

  const TypeSelect = ({ value, onChange }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={selSm}>
      <option value="wine">Wine</option>
      <option value="cocktail">Cocktail</option>
      <option value="spirit">Spirit</option>
      <option value="beer">Beer</option>
    </select>
  );

  const pickerProps = (type) => ({ wines, cocktails, spirits, beers, type, style: inpSm });

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 16 }}>
        QUICK ACCESS — configure aperitif/drink buttons shown during service
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {quickAccessItems.map((item, idx) => (
          <div key={item.id} style={{
            border: `1px solid ${editingId === item.id ? "#c8c6e8" : item.enabled ? "#e8e8e8" : "#f0f0f0"}`,
            borderRadius: 0, background: item.enabled ? "#fff" : "#fafafa",
            opacity: item.enabled ? 1 : 0.6,
          }}>
            {/* Row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
              <button onClick={() => toggleItem(item.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px", border: "1px solid",
                borderColor: item.enabled ? "#4a9a6a" : "#ddd", borderRadius: 0, cursor: "pointer",
                background: item.enabled ? "#f0faf0" : "#fff",
                color: item.enabled ? "#4a9a6a" : "#aaa", flexShrink: 0,
              }}>{item.enabled ? "ON" : "OFF"}</button>

              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{item.label}</div>
                <div style={{ fontFamily: FONT, fontSize: 9, color: "#999" }}>
                  search: <span style={{ color: "#4b4b88" }}>{item.searchKey}</span> · {item.type}
                  {item.menuOnly && <span style={{ marginLeft: 6, color: "#c8a060", fontWeight: 600 }}>menu only</span>}
                </div>
              </div>

              <button onClick={() => onUpdateQuickAccess(quickAccessItems.map(i => i.id === item.id ? { ...i, menuOnly: !i.menuOnly } : i))} style={{
                fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: "4px 8px", border: "1px solid",
                borderColor: item.menuOnly ? "#c8a060" : "#e8e8e8", borderRadius: 0, cursor: "pointer",
                background: item.menuOnly ? "#fdf4e8" : "#fff",
                color: item.menuOnly ? "#7a5020" : "#bbb", flexShrink: 0,
                whiteSpace: "nowrap",
              }}>MENU ONLY</button>

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
                  borderRadius: 0, cursor: "pointer",
                  background: editingId === item.id ? "#4b4b88" : "#fff",
                  color: editingId === item.id ? "#1a1a1a" : "#888", flexShrink: 0,
                }}>{editingId === item.id ? "SAVE" : "EDIT"}</button>

              <button onClick={() => removeItem(item.id)} style={{
                background: "none", border: "1px solid #ffcccc", borderRadius: 0,
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
                  <div style={{ fontFamily: FONT, fontSize: 8, color: "#999", letterSpacing: 1, marginBottom: 3 }}>LINKED PRODUCT</div>
                  <WinePickerInput value={editKey} onChange={setEditKey} {...pickerProps(editType)} />
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

      {/* Add new item */}
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
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>LINKED PRODUCT</div>
            <WinePickerInput value={newSearchKey} onChange={setNewSearchKey} {...pickerProps(newType)} />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", marginBottom: 2 }}>TYPE</div>
            <TypeSelect value={newType} onChange={setNewType} />
          </div>
        </div>
        <button onClick={addItem} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: "1px solid #1a1a1a", borderRadius: 0, cursor: "pointer",
          background: "#ffffff", color: "#1a1a1a",
        }}>+ ADD ITEM</button>
      </div>
    </div>
  );
}
