import { useState, useRef, useEffect } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT, baseInp } from "./adminStyles.js";
import { fuzzy, fuzzyDrink } from "../../utils/search.js";
import { buildBeverageLinkedKey, resolveAperitifFromQuickAccessOption } from "../../utils/quickAccessResolve.js";

// ── WinePickerInput — sets stable linkedKey + display searchKey ─────────────
function WinePickerInput({ searchKey, linkedKey, onPick, type, wines, cocktails, spirits, beers, style }) {
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
    if (type === "wine") {
      const sk = String(item.name || item.wine_name || item.producer || "").trim();
      onPick({ searchKey: sk, linkedKey: item.id });
    } else {
      const name = String(item.name || "").trim();
      onPick({ searchKey: name, linkedKey: buildBeverageLinkedKey(type, name) });
    }
    setQ("");
    setOpen(false);
  };

  const chipText = searchKey || linkedKey || "";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {(searchKey || linkedKey) && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.secondary, background: tokens.neutral[100], border: tokens.border.default, borderRadius: 0, padding: "2px 6px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chipText}
          </span>
          <button type="button" onClick={() => onPick({ searchKey: "", linkedKey: undefined })} style={{ background: "none", border: "none", cursor: "pointer", color: tokens.text.disabled, fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={(searchKey || linkedKey) ? "search to replace…" : "search wines…"}
        style={style}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300,
          background: tokens.surface.card, border: tokens.border.subtle, borderRadius: 0,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 260, overflowY: "auto",
        }}>
          {results.map((item, i) => (
            <div
              key={item.id ?? i}
              onMouseDown={e => { e.preventDefault(); selectItem(item); }}
              style={{ fontFamily: FONT, fontSize: 10, padding: "8px 10px", cursor: "pointer", borderBottom: tokens.border.subtle }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.neutral[50]}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontWeight: 600, color: tokens.text.primary }}>{item.name}</span>
              {item.producer && <span style={{ color: tokens.text.muted }}> · {item.producer}</span>}
              {item.vintage  && <span style={{ color: tokens.text.disabled }}> · {item.vintage}</span>}
              {item.byGlass  && <span style={{ color: tokens.green.text, marginLeft: 4, fontSize: 8 }}>BTG</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function linkedPreviewText(item, wines, cocktails, spirits, beers) {
  const ap = {
    label: item.label,
    searchKey: item.searchKey || item.label,
    linkedKey: item.linkedKey,
    type: item.type || "wine",
  };
  const r = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
  if (!r) return null;
  if ((item.type || "wine") === "wine") {
    return r.producer ? `${r.producer} – ${r.name}` : r.name;
  }
  return r.name;
}

// ── QuickAccessPanel — configure which drinks appear in Quick Access buttons ──
export default function QuickAccessPanel({
  quickAccessItems = [],
  onUpdateQuickAccess,
  wines = [], cocktails = [], spirits = [], beers = [],
}) {
  const [newLabel,     setNewLabel]     = useState("");
  const [newSearchKey, setNewSearchKey] = useState("");
  const [newLinkedKey, setNewLinkedKey] = useState(undefined);
  const [newType,      setNewType]      = useState("wine");
  const [editingId,    setEditingId]    = useState(null);
  const [editLabel,    setEditLabel]    = useState("");
  const [editKey,      setEditKey]      = useState("");
  const [editLinkedKey, setEditLinkedKey] = useState(undefined);
  const [editType,     setEditType]     = useState("wine");

  const addItem = () => {
    if (!newLabel.trim()) return;
    const item = {
      id: Date.now(),
      label: newLabel.trim(),
      searchKey: newSearchKey.trim() || newLabel.trim(),
      linkedKey: newLinkedKey,
      type: newType,
      enabled: true,
    };
    onUpdateQuickAccess([...quickAccessItems, item]);
    setNewLabel(""); setNewSearchKey(""); setNewLinkedKey(undefined);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditKey(item.searchKey || item.label);
    setEditLinkedKey(item.linkedKey);
    setEditType(item.type || "wine");
  };

  const saveEdit = () => {
    onUpdateQuickAccess(quickAccessItems.map(i =>
      i.id === editingId
        ? {
          ...i,
          label: editLabel.trim() || i.label,
          searchKey: editKey.trim() || editLabel.trim() || i.label,
          linkedKey: editLinkedKey,
          type: editType,
        }
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

  const pickerProps = (type, searchKey, linkedKey, onPick) => ({
    wines, cocktails, spirits, beers, type, searchKey, linkedKey, onPick, style: inpSm,
  });

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.text.muted, marginBottom: 16 }}>
        QUICK ACCESS — configure aperitif/drink buttons shown during service
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {quickAccessItems.map((item, idx) => {
          const preview = linkedPreviewText(item, wines, cocktails, spirits, beers);
          const broken = Boolean(item.linkedKey) && !preview;
          return (
            <div key={item.id} style={{
              border: `1px solid ${editingId === item.id ? tokens.charcoal.default : item.enabled ? tokens.neutral[200] : tokens.neutral[200]}`,
              borderRadius: 0, background: item.enabled ? tokens.surface.card : tokens.neutral[50],
              opacity: item.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                <button type="button" onClick={() => toggleItem(item.id)} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px", border: "1px solid",
                  borderColor: item.enabled ? tokens.green.border : tokens.neutral[300], borderRadius: 0, cursor: "pointer",
                  background: item.enabled ? tokens.green.bg : tokens.surface.card,
                  color: item.enabled ? tokens.green.text : tokens.text.disabled, flexShrink: 0,
                }}>{item.enabled ? "ON" : "OFF"}</button>

                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.text.primary }}>{item.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.muted }}>
                    search: <span style={{ color: tokens.text.secondary }}>{item.searchKey}</span>
                    {item.linkedKey && <span style={{ color: tokens.text.secondary }}> · id: {String(item.linkedKey).slice(0, 36)}{String(item.linkedKey).length > 36 ? "…" : ""}</span>}
                    {" · "}{item.type || "wine"}
                    {item.menuOnly && <span style={{ marginLeft: 6, color: tokens.neutral[700], fontWeight: 600 }}>menu only</span>}
                  </div>
                  {preview && (
                    <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, marginTop: 4 }}>
                      → {preview}
                    </div>
                  )}
                  {broken && (
                    <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 4, fontWeight: 600 }}>
                      Linked product missing — re-pick in EDIT or button falls back to label only.
                    </div>
                  )}
                </div>

                <button type="button" onClick={() => onUpdateQuickAccess(quickAccessItems.map(i => i.id === item.id ? { ...i, menuOnly: !i.menuOnly } : i))} style={{
                  fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: "4px 8px", border: "1px solid",
                  borderColor: item.menuOnly ? tokens.neutral[400] : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                  background: item.menuOnly ? tokens.neutral[100] : tokens.surface.card,
                  color: item.menuOnly ? tokens.text.body : tokens.text.disabled, flexShrink: 0,
                  whiteSpace: "nowrap",
                }}>MENU ONLY</button>

                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                    style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? tokens.neutral[300] : tokens.text.muted, fontSize: 12, padding: "2px 4px" }}>▲</button>
                  <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === quickAccessItems.length - 1}
                    style={{ background: "none", border: "none", cursor: idx === quickAccessItems.length - 1 ? "default" : "pointer", color: idx === quickAccessItems.length - 1 ? tokens.neutral[300] : tokens.text.muted, fontSize: 12, padding: "2px 4px" }}>▼</button>
                </div>

                <button
                  type="button"
                  onClick={() => editingId === item.id ? saveEdit() : startEdit(item)}
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                    border: `1px solid ${editingId === item.id ? tokens.charcoal.default : tokens.neutral[300]}`,
                    borderRadius: 0, cursor: "pointer",
                    background: editingId === item.id ? tokens.charcoal.default : tokens.surface.card,
                    color: editingId === item.id ? tokens.text.inverse : tokens.text.muted, flexShrink: 0,
                  }}>{editingId === item.id ? "SAVE" : "EDIT"}</button>

                <button type="button" onClick={() => removeItem(item.id)} style={{
                  background: "none", border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                  color: tokens.red.text, cursor: "pointer", fontFamily: FONT, fontSize: 9,
                  letterSpacing: 1, padding: "4px 8px", flexShrink: 0,
                }}>REMOVE</button>
              </div>

              {editingId === item.id && (
                <div style={{ padding: "0 14px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.text.muted, letterSpacing: 1, marginBottom: 3 }}>BUTTON LABEL</div>
                    <input value={editLabel} onChange={e => setEditLabel(e.target.value)} style={inpSm} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.text.muted, letterSpacing: 1, marginBottom: 3 }}>LINKED PRODUCT</div>
                    <WinePickerInput
                      {...pickerProps(editType, editKey, editLinkedKey, ({ searchKey, linkedKey }) => {
                        setEditKey(searchKey);
                        setEditLinkedKey(linkedKey);
                      })}
                    />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.text.muted, letterSpacing: 1, marginBottom: 3 }}>TYPE</div>
                    <TypeSelect value={editType} onChange={(t) => {
                      setEditType(t);
                      setEditLinkedKey(undefined);
                    }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {quickAccessItems.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.text.disabled, textAlign: "center", padding: "30px 0" }}>
            No quick access items configured
          </div>
        )}
      </div>

      <div style={{ borderTop: tokens.border.subtle, paddingTop: 18 }}>
        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.text.muted, textTransform: "uppercase", marginBottom: 8 }}>Add item</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.text.muted, marginBottom: 2 }}>BUTTON LABEL</div>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="e.g. Slapšak" style={inpSm} />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.text.muted, marginBottom: 2 }}>LINKED PRODUCT</div>
            <WinePickerInput
              {...pickerProps(newType, newSearchKey, newLinkedKey, ({ searchKey, linkedKey }) => {
                setNewSearchKey(searchKey);
                setNewLinkedKey(linkedKey);
              })}
            />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.text.muted, marginBottom: 2 }}>TYPE</div>
            <TypeSelect value={newType} onChange={(t) => { setNewType(t); setNewLinkedKey(undefined); }} />
          </div>
        </div>
        <button type="button" onClick={addItem} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
          background: tokens.charcoal.default, color: tokens.text.inverse,
        }}>+ ADD ITEM</button>
      </div>
    </div>
  );
}
