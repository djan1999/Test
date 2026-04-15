import { useRef, useState, useCallback } from "react";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel } from "../../styles/mixins.js";
import MenuCoursesTab from "./MenuCoursesTab.jsx";
import DrinkListEditor from "./DrinkListEditor.jsx";
import WineSyncTab from "./WineSyncTab.jsx";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };

export default function AdminPanel({
  dishes, wines, cocktails, spirits, beers, menuCourses,
  onUpdateDishes, onUpdateWines, onSaveBeverages, onResetMenuLayout,
  onUpdateMenuCourses, onSaveMenuCourses, onSyncWines,
  logoDataUri = "", onSaveLogo, onClose,
}) {
  const [tab, setTab] = useState("menu");
  const [drinkTab, setDrinkTab] = useState("wines");
  const isMobile = useIsMobile(700);

  // ── Dishes ──
  const [localDishes, setLocalDishes] = useState(dishes.map(d => ({ ...d, pairings: [...d.pairings] })));
  const [newDishName, setNewDishName] = useState("");
  const nextDishId = useRef(Math.max(...dishes.map(d => d.id), 0) + 1);
  const addDish = () => { if (!newDishName.trim()) return; setLocalDishes(l => [...l, { id: nextDishId.current++, name: newDishName.trim(), pairings: ["—", "Wine", "Non-Alc"] }]); setNewDishName(""); };
  const removeDish    = id         => setLocalDishes(l => l.filter(d => d.id !== id));
  const updDishName   = (id, v)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, name: v } : d));
  const addPairing    = id         => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: [...d.pairings, ""] } : d));
  const updPairing    = (id, i, v) => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.map((p, idx) => idx === i ? v : p) } : d));
  const removePairing = (id, i)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.filter((_, idx) => idx !== i) } : d));

  // ── Wines ──
  const [localWines, setLocalWines] = useState(wines.map(w => ({ ...w })));
  const [newWine, setNewWine] = useState({ name: "", producer: "", vintage: "", byGlass: false });
  const nextWineId = useRef(Math.max(...wines.map(w => w.id), 0) + 1);
  const addWine    = () => { if (!newWine.name.trim()) return; setLocalWines(l => [...l, { ...newWine, id: nextWineId.current++ }]); setNewWine({ name: "", producer: "", vintage: "", byGlass: false }); };
  const removeWine = id       => setLocalWines(l => l.filter(w => w.id !== id));
  const updWine    = (id,f,v) => setLocalWines(l => l.map(w => w.id === id ? { ...w, [f]: v } : w));

  // ── Cocktails ──
  const [localCocktails, setLocalCocktails] = useState(cocktails.map(c => ({ ...c })));
  const [newCocktail, setNewCocktail] = useState({ name: "", notes: "" });
  const nextCocktailId = useRef(Math.max(...cocktails.map(c => c.id), 0) + 1);

  // ── Spirits ──
  const [localSpirits, setLocalSpirits] = useState(spirits.map(s => ({ ...s })));
  const [newSpirit, setNewSpirit] = useState({ name: "", notes: "" });
  const nextSpiritId = useRef(Math.max(...spirits.map(s => s.id), 0) + 1);

  // ── Beers ──
  const [localBeers, setLocalBeers] = useState(beers.map(b => ({ ...b })));
  const [newBeer, setNewBeer] = useState({ name: "", notes: "" });
  const nextBeerId = useRef(Math.max(...beers.map(b => b.id), 0) + 1);

  const [drinksSaved, setDrinksSaved] = useState(false);
  const handleSaveDrinks = useCallback(async () => {
    onUpdateDishes(localDishes);
    await onUpdateWines(localWines);
    await onSaveBeverages({ cocktails: localCocktails, spirits: localSpirits, beers: localBeers });
    setDrinksSaved(true);
    setTimeout(() => setDrinksSaved(false), 2000);
  }, [localDishes, localWines, localCocktails, localSpirits, localBeers, onUpdateDishes, onUpdateWines, onSaveBeverages]);

  const SECTIONS = [
    { id: "menu",         label: "Menu Layout" },
    { id: "drinks",       label: "Drinks" },
    { id: "dishes",       label: "Extras" },
    { id: "sync",         label: "Sync" },
    { id: "settings",     label: "Settings" },
  ];

  const tabBtn = t => ({
    fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "9px 18px",
    border: "none", cursor: "pointer", textTransform: "uppercase", transition: "all 0.1s",
    background: tab === t ? "#f0efed" : "#fff",
    color: tab === t ? "#1a1a1a" : "#444",
    borderBottom: tab === t ? "none" : "1px solid #e8e8e8",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(4px)", zIndex: 500,
      display: "flex", alignItems: "stretch", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderTop: "1px solid #e8e8e8",
        width: "100%", maxWidth: 900,
        maxHeight: "100vh", overflow: "hidden",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.10)",
        display: "flex", flexDirection: "column",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e8e8e8", flexShrink: 0 }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#1a1a1a" }}>ADMIN</span>
          <button onClick={onClose} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #e8e8e8", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#888" }}>CLOSE</button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8", flexShrink: 0, overflowX: "auto" }}>
          {SECTIONS.map(s => <button key={s.id} style={tabBtn(s.id)} onClick={() => setTab(s.id)}>{s.label}</button>)}
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", padding: isMobile ? "20px 16px" : "24px 28px", flex: 1, overflowX: "hidden" }}>

          {/* ── MENU LAYOUT ── Full course editor */}
          {tab === "menu" && (
            <MenuCoursesTab
              menuCourses={menuCourses}
              onUpdateCourses={onUpdateMenuCourses}
              onSaveCourses={onSaveMenuCourses}
            />
          )}

          {/* ── DRINKS ── Wines, cocktails, spirits, beers */}
          {tab === "drinks" && (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 8 }}>
                {["wines", "cocktails", "spirits", "beers"].map(t => (
                  <button key={t} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
                    border: `1px solid ${drinkTab === t ? "#1a1a1a" : "#e8e8e8"}`,
                    borderRadius: 0, cursor: "pointer",
                    background: drinkTab === t ? "#f0efed" : "#fff",
                    color: drinkTab === t ? "#1a1a1a" : "#888",
                    marginRight: 6, marginBottom: 12,
                  }} onClick={() => setDrinkTab(t)}>{t.toUpperCase()}</button>
                ))}
                <button onClick={handleSaveDrinks} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
                  border: `1px solid ${drinksSaved ? "#888" : "#4a9a6a"}`, borderRadius: 0, cursor: "pointer",
                  background: drinksSaved ? "#888" : "#4a9a6a", color: "#fff", marginLeft: "auto",
                  transition: "background 0.2s, border-color 0.2s",
                }}>{drinksSaved ? "SAVED" : "SAVE DRINKS"}</button>
              </div>

              {drinkTab === "wines" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 70px 52px 28px", gap: 8, marginBottom: 8 }}>
                    {(isMobile ? ["Name", "Producer"] : ["Name", "Producer", "Vintage", "Glass", ""]).map((h, i) => (
                      <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 10 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 20 }}>
                    {localWines.map(w => (
                      <div key={w.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr auto" : "1fr 1fr 70px 52px 28px", gap: 8, alignItems: "center" }}>
                        <input value={w.name} onChange={e => updWine(w.id, "name", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
                        <input value={w.producer} onChange={e => updWine(w.id, "producer", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Producer" />
                        {!isMobile && <input value={w.vintage} onChange={e => updWine(w.id, "vintage", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="2020" />}
                        <button onClick={() => updWine(w.id, "byGlass", !w.byGlass)} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                          borderColor: w.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 0, cursor: "pointer",
                          background: w.byGlass ? "#f0faf0" : "#fff", color: w.byGlass ? "#4a8a4a" : "#555",
                        }}>{w.byGlass ? "YES" : "NO"}</button>
                        <button onClick={() => removeWine(w.id)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                    <div style={fieldLabel}>Add wine</div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 70px 52px", gap: 8, marginBottom: 10 }}>
                      <input value={newWine.name} onChange={e => setNewWine(w => ({ ...w, name: e.target.value }))} placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
                      <input value={newWine.producer} onChange={e => setNewWine(w => ({ ...w, producer: e.target.value }))} placeholder="Producer" style={{ ...baseInp, padding: "5px 8px" }} />
                      {!isMobile && <input value={newWine.vintage} onChange={e => setNewWine(w => ({ ...w, vintage: e.target.value }))} placeholder="2020" style={{ ...baseInp, padding: "5px 8px" }} />}
                      <button onClick={() => setNewWine(w => ({ ...w, byGlass: !w.byGlass }))} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                        borderColor: newWine.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 0, cursor: "pointer",
                        background: newWine.byGlass ? "#f0faf0" : "#fff", color: newWine.byGlass ? "#4a8a4a" : "#555",
                      }}>{newWine.byGlass ? "YES" : "NO"}</button>
                    </div>
                    <button onClick={addWine} style={{
                      fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
                      border: "1px solid #1a1a1a", borderRadius: 0, cursor: "pointer", background: "#ffffff", color: "#1a1a1a",
                    }}>+ ADD WINE</button>
                  </div>
                </>
              )}

              {drinkTab === "cocktails" && (
                <DrinkListEditor list={localCocktails} setList={setLocalCocktails}
                  newItem={newCocktail} setNewItem={setNewCocktail}
                  nextId={nextCocktailId} label="cocktail" />
              )}

              {drinkTab === "spirits" && (
                <DrinkListEditor list={localSpirits} setList={setLocalSpirits}
                  newItem={newSpirit} setNewItem={setNewSpirit}
                  nextId={nextSpiritId} label="spirit" />
              )}

              {drinkTab === "beers" && (
                <DrinkListEditor list={localBeers} setList={setLocalBeers}
                  newItem={newBeer} setNewItem={setNewBeer}
                  nextId={nextBeerId} label="beer" />
              )}
            </div>
          )}

          {/* ── EXTRAS (dishes) ── */}
          {tab === "dishes" && (
            <>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 16 }}>
                EXTRA DISH OPTIONS — optional courses offered to guests (beetroot, cheese, cake, etc.)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
                {localDishes.map(dish => (
                  <div key={dish.id} style={{ border: "1px solid #f0f0f0", borderRadius: 0, padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <input value={dish.name} onChange={e => updDishName(dish.id, e.target.value)} style={{ ...baseInp, fontWeight: 500, flex: 1 }} />
                      <button onClick={() => removeDish(dish.id)} style={{ background: "none", border: "1px solid #ffcccc", borderRadius: 0, color: "#e07070", cursor: "pointer", fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px" }}>REMOVE</button>
                    </div>
                    <div style={{ ...fieldLabel, marginBottom: 8 }}>Pairing options</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dish.pairings.map((p, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input value={p} onChange={e => updPairing(dish.id, idx, e.target.value)}
                            style={{ fontFamily: FONT, fontSize: 11, padding: "4px 8px", border: "1px solid #e8e8e8", borderRadius: 0, width: 80, outline: "none", color: "#1a1a1a", background: "#fafafa" }} />
                          {dish.pairings.length > 1 && (
                            <button onClick={() => removePairing(dish.id, idx)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => addPairing(dish.id)} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 9px", border: "1px solid #e0e0e0", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#444" }}>+ option</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 18 }}>
                <div style={fieldLabel}>Add dish</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={newDishName} onChange={e => setNewDishName(e.target.value)} onKeyDown={e => e.key === "Enter" && addDish()} placeholder="Dish name…" style={{ ...baseInp, flex: 1 }} />
                  <button onClick={addDish} style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 16px", border: "1px solid #1a1a1a", borderRadius: 0, cursor: "pointer", background: "#ffffff", color: "#1a1a1a", whiteSpace: "nowrap" }}>+ ADD</button>
                </div>
              </div>
              <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 24, paddingTop: 14 }}>
                <button onClick={() => { onUpdateDishes(localDishes); }} style={{
                  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
                  border: "1px solid #1a1a1a", borderRadius: 0, cursor: "pointer", background: "#ffffff", color: "#1a1a1a",
                }}>SAVE EXTRAS</button>
              </div>
            </>
          )}

          {/* ── SYNC ── Wine sync from hotel website */}
          {tab === "sync" && (
            <WineSyncTab onSyncWines={onSyncWines} />
          )}

          {/* ── SETTINGS ── Logo, layout reset */}
          {tab === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Logo */}
              <div>
                <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Menu Logo</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 64, height: 64, border: "1px solid #e8e8e8", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", flexShrink: 0 }}>
                    {logoDataUri
                      ? <img src={logoDataUri} alt="logo" style={{ width: 52, height: 52, objectFit: "contain" }} />
                      : <span style={{ fontFamily: FONT, fontSize: 8, color: "#ccc", letterSpacing: 1 }}>NO LOGO</span>
                    }
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginBottom: 8 }}>
                      Upload PNG, JPG, or SVG. Will be embedded in all printed menus.
                    </div>
                    <label style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #1a1a1a", borderRadius: 0, cursor: "pointer", background: "#ffffff", color: "#1a1a1a", display: "inline-block" }}>
                      UPLOAD LOGO
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = ev => onSaveLogo(ev.target.result);
                        reader.readAsDataURL(file);
                      }} />
                    </label>
                    {logoDataUri && (
                      <button onClick={() => onSaveLogo("")} style={{ marginLeft: 8, fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #e08080", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#c04040" }}>
                        REMOVE
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Layout reset */}
              <div>
                <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Print Layout</div>
                <div style={{ border: "1px solid #f8e8e8", borderRadius: 0, padding: "16px 18px", background: "#fffafa" }}>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: "#444", marginBottom: 6 }}>Reset to factory defaults</div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", marginBottom: 14 }}>
                    Clears all saved layout customisations (row spacing, padding, font size, etc.) and restores the original values.
                  </div>
                  <button
                    onClick={() => { if (window.confirm("Reset print layout to factory defaults?")) onResetMenuLayout(); }}
                    style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #e08080", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#c04040" }}
                  >RESET LAYOUT TO DEFAULTS</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ── Reservation Modal ─────────────────────────────────────────────────────────
