import { useState, useRef, useEffect } from "react";
import { tokens } from "../../styles/tokens.js";
import { digestivoVariantOptions } from "../../utils/digestivo.js";
import { FONT, baseInp } from "./adminStyles.js";
import { fuzzy, fuzzyDrink } from "../../utils/search.js";
import { buildBeverageLinkedKey, resolveAperitifFromQuickAccessOption } from "../../utils/quickAccessResolve.js";

// ── WinePickerInput — sets stable linkedKey + display searchKey ─────────────
function WinePickerInput({ searchKey, linkedKey, onPick, type, wines, cocktails, spirits, beers, teas = [], coffees = [], style }) {
  const [q, setQ]       = useState("");
  const [open, setOpen] = useState(false);
  const ref             = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const byType = { wine: wines, cocktail: cocktails, spirit: spirits, beer: beers, tea: teas, coffee: coffees };
  const list = byType[type] || beers;
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
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2], background: tokens.ink[5], border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "2px 6px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chipText}
          </span>
          <button type="button" onClick={() => onPick({ searchKey: "", linkedKey: undefined })} style={{ background: "none", border: "none", cursor: "pointer", color: tokens.ink[4], fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={(searchKey || linkedKey) ? "search to replace…"
          : `search ${type === "wine" ? "wines" : type === "tea" || type === "coffee" ? type : `${type}s`}…`}
        style={style}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300,
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
          maxHeight: 260, overflowY: "auto",
        }}>
          {results.map((item, i) => (
            <div
              key={item.id ?? i}
              onMouseDown={e => { e.preventDefault(); selectItem(item); }}
              style={{ fontFamily: FONT, fontSize: 10, padding: "8px 10px", cursor: "pointer", borderBottom: `1px solid ${tokens.ink[4]}` }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.ink.bg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontWeight: 600, color: tokens.ink[0] }}>{item.name}</span>
              {item.producer && <span style={{ color: tokens.ink[3] }}> · {item.producer}</span>}
              {item.vintage  && <span style={{ color: tokens.ink[4] }}> · {item.vintage}</span>}
              {item.byGlass  && <span style={{ color: tokens.green.text, marginLeft: 4, fontSize: 8 }}>BTG</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function linkedPreviewText(item, catalogs) {
  const ap = {
    label: item.label,
    searchKey: item.searchKey || item.label,
    linkedKey: item.linkedKey,
    type: item.type || "wine",
  };
  const r = resolveAperitifFromQuickAccessOption(ap, catalogs);
  if (!r) return null;
  if ((item.type || "wine") === "wine") {
    return r.producer ? `${r.producer} – ${r.name}` : r.name;
  }
  return r.name;
}

// ── QuickAccessPanel — configure which drinks appear in Quick Access buttons ──
//
// Two lists share this editor, because they are the same thing served at two
// moments: the APERITIF buttons (before the menu) and the DIGESTIVO buttons
// (inside it, above the anchored course). Only the copy and one toggle
// differ, so the panel takes them as props rather than being forked:
//   heading        — the strip above the list
//   addPlaceholder — the example label in the add form
//   showMenuOnly   — the MENU ONLY toggle, which is an aperitif-only idea
//                    (the printed menu has no digestivo section to hide in)
//   showVariants   — the subcategory editor. A digestivo button scrolls its
//                    subcategories the way the pairing button scrolls its
//                    types ("Coffee" → espresso → cappuccino → …); an aperitif
//                    button is a single product and has none.
export default function QuickAccessPanel({
  quickAccessItems = [],
  onUpdateQuickAccess,
  wines = [], cocktails = [], spirits = [], beers = [], teas = [], coffees = [],
  heading = "QUICK ACCESS — configure aperitif/drink buttons shown during service",
  addPlaceholder = "e.g. Slapšak",
  emptyLabel = "No quick access items configured",
  showMenuOnly = true,
  showVariants = false,
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

  // Subcategories are edited in place rather than behind EDIT: they are the
  // part of a digestivo button the kitchen actually reads, and burying them
  // one click deep is how a button ships with none by accident.
  const updVariants = (id, next) => {
    onUpdateQuickAccess(quickAccessItems.map(i => i.id === id ? { ...i, variants: next } : i));
  };
  // Subcategories are rows of their own now — each links to a product, because
  // the category above them does not name one. A config written before that
  // stored a bare string per row; digestivoVariantOptions reads both.
  const variantsOf = (item) => digestivoVariantOptions(item);
  const addVariant    = (item)        => updVariants(item.id, [...variantsOf(item), { label: "", type: "coffee" }]);
  const setVariant    = (item, at, patch) =>
    updVariants(item.id, variantsOf(item).map((x, i) => i === at ? { ...x, ...patch } : x));
  const removeVariant = (item, at)    => updVariants(item.id, variantsOf(item).filter((_, i) => i !== at));
  // One subcategory is enough to make the parent a grouping: its own link stops
  // being read (utils/digestivo resolveDigestivoProduct) so it stops being shown.
  const isGroup = (item) => showVariants && variantsOf(item).length > 0;

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
      <option value="tea">Tea</option>
      <option value="coffee">Coffee</option>
    </select>
  );

  const catalogs = { wines, cocktails, spirits, beers, teas, coffees };
  const pickerProps = (type, searchKey, linkedKey, onPick) => ({
    ...catalogs, type, searchKey, linkedKey, onPick, style: inpSm,
  });

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.ink[3], marginBottom: 16 }}>
        {heading}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {quickAccessItems.map((item, idx) => {
          const preview = linkedPreviewText(item, catalogs);
          const broken = Boolean(item.linkedKey) && !preview;
          return (
            <div key={item.id} style={{
              border: `1px solid ${editingId === item.id ? tokens.charcoal.default : item.enabled ? tokens.ink[4] : tokens.ink[4]}`,
              borderRadius: 0, background: item.enabled ? tokens.neutral[0] : tokens.ink.bg,
              opacity: item.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                <button type="button" onClick={() => toggleItem(item.id)} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px", border: "1px solid",
                  borderColor: item.enabled ? tokens.green.border : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                  background: item.enabled ? tokens.green.bg : tokens.neutral[0],
                  color: item.enabled ? tokens.green.text : tokens.ink[4], flexShrink: 0,
                }}>{item.enabled ? "ON" : "OFF"}</button>

                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.ink[0] }}>{item.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3] }}>
                    {isGroup(item) ? <span style={{ color: tokens.ink[2] }}>category — each subcategory links its own drink</span> : <>
                      search: <span style={{ color: tokens.ink[2] }}>{item.searchKey}</span>
                      {item.linkedKey && <span style={{ color: tokens.ink[2] }}> · id: {String(item.linkedKey).slice(0, 36)}{String(item.linkedKey).length > 36 ? "…" : ""}</span>}
                      {" · "}{item.type || "wine"}
                    </>}
                    {showMenuOnly && item.menuOnly && <span style={{ marginLeft: 6, color: tokens.ink[1], fontWeight: 600 }}>menu only</span>}
                    {showVariants && variantsOf(item).length > 0 && (
                      <span style={{ marginLeft: 6, color: tokens.ink[2] }}>
                        · {variantsOf(item).length} sub
                      </span>
                    )}
                  </div>
                  {preview && !isGroup(item) && (
                    <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, marginTop: 4 }}>
                      → {preview}
                    </div>
                  )}
                  {broken && !isGroup(item) && (
                    <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 4, fontWeight: 600 }}>
                      Linked product missing — re-pick in EDIT or button falls back to label only.
                    </div>
                  )}
                </div>

                {showMenuOnly && <button type="button" onClick={() => onUpdateQuickAccess(quickAccessItems.map(i => i.id === item.id ? { ...i, menuOnly: !i.menuOnly } : i))} style={{
                  fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: "4px 8px", border: "1px solid",
                  borderColor: item.menuOnly ? tokens.ink[3] : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                  background: item.menuOnly ? tokens.ink[5] : tokens.neutral[0],
                  color: item.menuOnly ? tokens.ink[1] : tokens.ink[4], flexShrink: 0,
                  whiteSpace: "nowrap",
                }}>MENU ONLY</button>}

                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                    style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? tokens.ink[4] : tokens.ink[3], fontSize: 12, padding: "2px 4px" }}>▲</button>
                  <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === quickAccessItems.length - 1}
                    style={{ background: "none", border: "none", cursor: idx === quickAccessItems.length - 1 ? "default" : "pointer", color: idx === quickAccessItems.length - 1 ? tokens.ink[4] : tokens.ink[3], fontSize: 12, padding: "2px 4px" }}>▼</button>
                </div>

                <button
                  type="button"
                  onClick={() => editingId === item.id ? saveEdit() : startEdit(item)}
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                    border: `1px solid ${editingId === item.id ? tokens.charcoal.default : tokens.ink[4]}`,
                    borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0],
                    color: editingId === item.id ? tokens.ink[0] : tokens.ink[3], flexShrink: 0,
                  }}>{editingId === item.id ? "SAVE" : "EDIT"}</button>

                <button type="button" onClick={() => removeItem(item.id)} style={{
                  background: "none", border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                  color: tokens.red.text, cursor: "pointer", fontFamily: FONT, fontSize: 9,
                  letterSpacing: 1, padding: "4px 8px", flexShrink: 0,
                }}>REMOVE</button>
              </div>

              {showVariants && (
                <div style={{ padding: "0 14px 12px" }}>
                  <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: 1, marginBottom: 5, textTransform: "uppercase" }}>
                    Subcategories — the seat's panel offers these, each with its own drink
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {variantsOf(item).map((v, i) => {
                      const vPreview = linkedPreviewText(
                        { label: v.label, searchKey: v.searchKey || v.label, linkedKey: v.linkedKey, type: v.type || "coffee" },
                        catalogs,
                      );
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 100px 24px", gap: 6, alignItems: "start" }}>
                          <input
                            value={v.label}
                            onChange={e => setVariant(item, i, { label: e.target.value })}
                            placeholder="e.g. Espresso"
                            aria-label={`${item.label} subcategory ${i + 1}`}
                            style={inpSm}
                          />
                          <div>
                            <WinePickerInput
                              {...pickerProps(v.type || "coffee", v.searchKey, v.linkedKey, ({ searchKey, linkedKey }) =>
                                setVariant(item, i, { searchKey, linkedKey }))}
                            />
                            {vPreview && (
                              <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.green.text, marginTop: 3 }}>→ {vPreview}</div>
                            )}
                          </div>
                          <select
                            value={v.type || "coffee"}
                            onChange={e => setVariant(item, i, { type: e.target.value, linkedKey: undefined })}
                            aria-label={`${item.label} subcategory ${i + 1} type`}
                            style={selSm}
                          >
                            <option value="coffee">Coffee</option>
                            <option value="tea">Tea</option>
                            <option value="spirit">Spirit</option>
                            <option value="cocktail">Cocktail</option>
                            <option value="beer">Beer</option>
                            <option value="wine">Wine</option>
                          </select>
                          <button type="button" onClick={() => removeVariant(item, i)}
                            aria-label={`Remove ${item.label} subcategory ${i + 1}`}
                            style={{ background: "none", border: "none", color: tokens.ink[3], cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "5px 0" }}>×</button>
                        </div>
                      );
                    })}
                    <div>
                      <button type="button" onClick={() => addVariant(item)} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 9px",
                        border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                        background: tokens.neutral[0], color: tokens.ink[1],
                      }}>+ subcategory</button>
                    </div>
                  </div>
                  {variantsOf(item).length === 0 && (
                    <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[4], marginTop: 5 }}>
                      None — the button is a plain on/off toggle and links its own drink above.
                    </div>
                  )}
                </div>
              )}

              {editingId === item.id && (
                <div style={{ padding: "0 14px 12px", display: "grid", gridTemplateColumns: isGroup(item) ? "1fr" : "1fr 1fr 100px", gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: 1, marginBottom: 3 }}>
                      {isGroup(item) ? "CATEGORY NAME" : "BUTTON LABEL"}
                    </div>
                    <input value={editLabel} onChange={e => setEditLabel(e.target.value)} style={inpSm} />
                    {isGroup(item) && (
                      <div style={{ fontFamily: FONT, fontSize: 8.5, color: tokens.ink[3], marginTop: 4, lineHeight: 1.5 }}>
                        A category names no drink — the bar cannot pour a “{editLabel || item.label}”.
                        Link the products on its subcategories above.
                      </div>
                    )}
                  </div>
                  {!isGroup(item) && <>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: 1, marginBottom: 3 }}>LINKED PRODUCT</div>
                    <WinePickerInput
                      {...pickerProps(editType, editKey, editLinkedKey, ({ searchKey, linkedKey }) => {
                        setEditKey(searchKey);
                        setEditLinkedKey(linkedKey);
                      })}
                    />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[3], letterSpacing: 1, marginBottom: 3 }}>TYPE</div>
                    <TypeSelect value={editType} onChange={(t) => {
                      setEditType(t);
                      setEditLinkedKey(undefined);
                    }} />
                  </div>
                  </>}
                </div>
              )}
            </div>
          );
        })}

        {quickAccessItems.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[4], textAlign: "center", padding: "30px 0" }}>
            {emptyLabel}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 18 }}>
        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 8 }}>Add item</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], marginBottom: 2 }}>BUTTON LABEL</div>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder={addPlaceholder} style={inpSm} />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], marginBottom: 2 }}>LINKED PRODUCT</div>
            <WinePickerInput
              {...pickerProps(newType, newSearchKey, newLinkedKey, ({ searchKey, linkedKey }) => {
                setNewSearchKey(searchKey);
                setNewLinkedKey(linkedKey);
              })}
            />
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.ink[3], marginBottom: 2 }}>TYPE</div>
            <TypeSelect value={newType} onChange={(t) => { setNewType(t); setNewLinkedKey(undefined); }} />
          </div>
        </div>
        <button type="button" onClick={addItem} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
          background: tokens.neutral[0], color: tokens.ink[0],
        }}>+ ADD ITEM</button>
      </div>
    </div>
  );
}
