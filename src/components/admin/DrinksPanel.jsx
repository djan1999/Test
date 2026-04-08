import { useState, useRef } from "react";
import { FONT, baseInp, fieldLabel, primaryBtn } from "./adminStyles.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

// ── DrinkListEditor — generic editor for cocktails, spirits, beers ──
function DrinkListEditor({ list, setList, newItem, setNewItem, nextId, label }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, marginBottom: 8 }}>
        {["Name", "Notes / Label", ""].map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {list.map(item => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, alignItems: "center" }}>
            <input value={item.name} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, name: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
            <input value={item.notes} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, notes: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="e.g. classic / on the rocks" />
            <button onClick={() => setList(l => l.filter(x => x.id !== item.id))} style={{
              background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={fieldLabel}>Add {label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input value={newItem.name} onChange={e => setNewItem(x => ({ ...x, name: e.target.value }))}
            placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
          <input value={newItem.notes} onChange={e => setNewItem(x => ({ ...x, notes: e.target.value }))}
            placeholder="Notes (optional)" style={{ ...baseInp, padding: "5px 8px" }}
            onKeyDown={e => { if (e.key === "Enter" && newItem.name.trim()) { setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }}} />
        </div>
        <button onClick={() => { if (!newItem.name.trim()) return; setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }} style={primaryBtn}>+ ADD {label.toUpperCase()}</button>
      </div>
    </>
  );
}

// ── DrinksPanel — manage wines, cocktails, spirits, beers + pairings ──
export default function DrinksPanel({
  dishes, wines, cocktails, spirits, beers,
  onUpdateWines, onSaveBeverages,
}) {
  const isMobile = useIsMobile(700);
  const [drinkTab, setDrinkTab] = useState("wines");

  // Local state for editing
  const [localWines, setLocalWines] = useState(wines.map(w => ({ ...w })));
  const [newWine, setNewWine] = useState({ name: "", producer: "", vintage: "", byGlass: false });
  const nextWineId = useRef(Math.max(...wines.map(w => w.id), 0) + 1);
  const addWine    = () => { if (!newWine.name.trim()) return; setLocalWines(l => [...l, { ...newWine, id: nextWineId.current++ }]); setNewWine({ name: "", producer: "", vintage: "", byGlass: false }); };
  const removeWine = id       => setLocalWines(l => l.filter(w => w.id !== id));
  const updWine    = (id,f,v) => setLocalWines(l => l.map(w => w.id === id ? { ...w, [f]: v } : w));

  const [localCocktails, setLocalCocktails] = useState(cocktails.map(c => ({ ...c })));
  const [newCocktail, setNewCocktail] = useState({ name: "", notes: "" });
  const nextCocktailId = useRef(Math.max(...cocktails.map(c => c.id), 0) + 1);

  const [localSpirits, setLocalSpirits] = useState(spirits.map(s => ({ ...s })));
  const [newSpirit, setNewSpirit] = useState({ name: "", notes: "" });
  const nextSpiritId = useRef(Math.max(...spirits.map(s => s.id), 0) + 1);

  const [localBeers, setLocalBeers] = useState(beers.map(b => ({ ...b })));
  const [newBeer, setNewBeer] = useState({ name: "", notes: "" });
  const nextBeerId = useRef(Math.max(...beers.map(b => b.id), 0) + 1);

  const handleSaveDrinks = () => {
    onUpdateWines(localWines);
    onSaveBeverages({ cocktails: localCocktails, spirits: localSpirits, beers: localBeers });
  };

  const tabBtn = t => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
    border: `1px solid ${drinkTab === t ? "#1a1a1a" : "#e8e8e8"}`,
    borderRadius: 2, cursor: "pointer",
    background: drinkTab === t ? "#1a1a1a" : "#fff",
    color: drinkTab === t ? "#fff" : "#888",
    marginRight: 6, marginBottom: 12,
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 8 }}>
        {["wines", "cocktails", "spirits", "beers"].map(t => (
          <button key={t} style={tabBtn(t)} onClick={() => setDrinkTab(t)}>{t.toUpperCase()}</button>
        ))}
        <button onClick={handleSaveDrinks} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
          border: "1px solid #4a9a6a", borderRadius: 2, cursor: "pointer",
          background: "#4a9a6a", color: "#fff", marginLeft: "auto",
        }}>SAVE DRINKS</button>
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
                  borderColor: w.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 2, cursor: "pointer",
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
                borderColor: newWine.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 2, cursor: "pointer",
                background: newWine.byGlass ? "#f0faf0" : "#fff", color: newWine.byGlass ? "#4a8a4a" : "#555",
              }}>{newWine.byGlass ? "YES" : "NO"}</button>
            </div>
            <button onClick={addWine} style={primaryBtn}>+ ADD WINE</button>
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
  );
}
