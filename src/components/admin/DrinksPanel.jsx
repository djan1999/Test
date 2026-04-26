import { useState, useRef, useCallback } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT, baseInp, fieldLabel, primaryBtn } from "./adminStyles.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";

// ── DrinkListEditor — generic editor for cocktails, spirits, beers ──
function DrinkListEditor({ list, setList, newItem, setNewItem, nextId, label }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, marginBottom: 8 }}>
        {["Name", "Notes / Label", ""].map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[2], textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, marginBottom: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {list.map(item => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, alignItems: "center" }}>
            <input value={item.name} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, name: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
            <input value={item.notes} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, notes: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="e.g. classic / on the rocks" />
            <button onClick={() => setList(l => l.filter(x => x.id !== item.id))} style={{
              background: "none", border: "none", color: tokens.ink[2], cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 16 }}>
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
  const isMobile = useIsMobile(BP.md);
  const [drinkTab, setDrinkTab] = useState("wines");

  // Local state for editing
  const [localWines, setLocalWines] = useState(wines.map(w => ({ ...w })));
  const [newWine, setNewWine] = useState({ name: "", producer: "", vintage: "", region: "", byGlass: false });
  const addWine = () => {
    if (!newWine.name.trim()) return;
    const id = `manual|${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setLocalWines(l => [...l, { ...newWine, id }]);
    setNewWine({ name: "", producer: "", vintage: "", region: "", byGlass: false });
  };
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

  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const handleSaveDrinks = useCallback(async () => {
    setSaveError("");
    const wRes = await onUpdateWines(localWines);
    if (wRes && wRes.ok === false) {
      setSaveError(wRes.error || "Wine save failed");
      return;
    }
    const bRes = await onSaveBeverages({ cocktails: localCocktails, spirits: localSpirits, beers: localBeers });
    if (bRes && bRes.ok === false) {
      setSaveError(bRes.error || "Beverage save failed");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [localWines, localCocktails, localSpirits, localBeers, onUpdateWines, onSaveBeverages]);

  const tabBtn = t => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
    border: `1px solid ${drinkTab === t ? tokens.charcoal.default : tokens.ink[4]}`,
    borderRadius: 0, cursor: "pointer",
    background: drinkTab === t ? tokens.tint.parchment : tokens.neutral[0],
    color: drinkTab === t ? tokens.ink[1] : tokens.ink[3],
    marginRight: 6, marginBottom: 12,
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 8 }}>
        {["wines", "cocktails", "spirits", "beers"].map(t => (
          <button key={t} style={tabBtn(t)} onClick={() => setDrinkTab(t)}>{t.toUpperCase()}</button>
        ))}
        <button type="button" onClick={handleSaveDrinks} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
          border: `1px solid ${saved ? tokens.ink[3] : saveError ? tokens.red.border : tokens.green.border}`, borderRadius: 0, cursor: "pointer",
          background: tokens.neutral[0], color: saved ? tokens.ink[3] : saveError ? tokens.red.text : tokens.green.text, marginLeft: "auto",
          transition: "background 0.2s, border-color 0.2s",
        }}>{saved ? "SAVED" : "SAVE DRINKS"}</button>
      </div>
      {saveError && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text, marginBottom: 10, maxWidth: 560 }}>
          {saveError}
        </div>
      )}

      {drinkTab === "wines" && (
        <>
          {!isMobile && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 1fr 52px 28px", gap: 8, marginBottom: 8 }}>
                {["Name", "Producer", "Vintage", "Region", "Glass", ""].map((h, i) => (
                  <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[2], textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, marginBottom: 10 }} />
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 7, marginBottom: 20 }}>
            {localWines.map(w => (
              isMobile ? (
                <div key={w.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, background: tokens.neutral[0] }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 28px", gap: 8, alignItems: "center" }}>
                    <input value={w.name} onChange={e => updWine(w.id, "name", e.target.value)} style={{ ...baseInp, padding: "6px 8px" }} placeholder="Name" />
                    <button onClick={() => removeWine(w.id)} style={{ background: "none", border: "none", color: tokens.ink[2], cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                  <input value={w.producer} onChange={e => updWine(w.id, "producer", e.target.value)} style={{ ...baseInp, padding: "6px 8px" }} placeholder="Producer" />
                  <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 60px", gap: 8 }}>
                    <input value={w.vintage} onChange={e => updWine(w.id, "vintage", e.target.value)} style={{ ...baseInp, padding: "6px 8px" }} placeholder="2020" />
                    <input value={w.region || ""} onChange={e => updWine(w.id, "region", e.target.value)} style={{ ...baseInp, padding: "6px 8px" }} placeholder="Region, Country" />
                    <button onClick={() => updWine(w.id, "byGlass", !w.byGlass)} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 6px", border: "1px solid",
                      borderColor: w.byGlass ? tokens.green.border : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                      background: w.byGlass ? tokens.green.bg : tokens.neutral[0], color: w.byGlass ? tokens.green.text : tokens.ink[2],
                    }}>{w.byGlass ? "GLASS" : "BTL"}</button>
                  </div>
                </div>
              ) : (
                <div key={w.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 1fr 52px 28px", gap: 8, alignItems: "center" }}>
                  <input value={w.name} onChange={e => updWine(w.id, "name", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
                  <input value={w.producer} onChange={e => updWine(w.id, "producer", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Producer" />
                  <input value={w.vintage} onChange={e => updWine(w.id, "vintage", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="2020" />
                  <input value={w.region || ""} onChange={e => updWine(w.id, "region", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="e.g. Dolenjska, Slovenia" />
                  <button onClick={() => updWine(w.id, "byGlass", !w.byGlass)} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                    borderColor: w.byGlass ? tokens.green.border : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                    background: w.byGlass ? tokens.green.bg : tokens.neutral[0], color: w.byGlass ? tokens.green.text : tokens.ink[2],
                  }}>{w.byGlass ? "YES" : "NO"}</button>
                  <button onClick={() => removeWine(w.id)} style={{ background: "none", border: "none", color: tokens.ink[2], cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              )
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 16 }}>
            <div style={fieldLabel}>Add wine</div>
            {isMobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                <input value={newWine.name} onChange={e => setNewWine(w => ({ ...w, name: e.target.value }))} placeholder="Name" style={{ ...baseInp, padding: "6px 8px" }} />
                <input value={newWine.producer} onChange={e => setNewWine(w => ({ ...w, producer: e.target.value }))} placeholder="Producer" style={{ ...baseInp, padding: "6px 8px" }} />
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 60px", gap: 8 }}>
                  <input value={newWine.vintage} onChange={e => setNewWine(w => ({ ...w, vintage: e.target.value }))} placeholder="2020" style={{ ...baseInp, padding: "6px 8px" }} />
                  <input value={newWine.region} onChange={e => setNewWine(w => ({ ...w, region: e.target.value }))} placeholder="Region, Country" style={{ ...baseInp, padding: "6px 8px" }} />
                  <button onClick={() => setNewWine(w => ({ ...w, byGlass: !w.byGlass }))} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 6px", border: "1px solid",
                    borderColor: newWine.byGlass ? tokens.green.border : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                    background: newWine.byGlass ? tokens.green.bg : tokens.neutral[0], color: newWine.byGlass ? tokens.green.text : tokens.ink[2],
                  }}>{newWine.byGlass ? "GLASS" : "BTL"}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 1fr 52px", gap: 8, marginBottom: 10 }}>
                <input value={newWine.name} onChange={e => setNewWine(w => ({ ...w, name: e.target.value }))} placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
                <input value={newWine.producer} onChange={e => setNewWine(w => ({ ...w, producer: e.target.value }))} placeholder="Producer" style={{ ...baseInp, padding: "5px 8px" }} />
                <input value={newWine.vintage} onChange={e => setNewWine(w => ({ ...w, vintage: e.target.value }))} placeholder="2020" style={{ ...baseInp, padding: "5px 8px" }} />
                <input value={newWine.region} onChange={e => setNewWine(w => ({ ...w, region: e.target.value }))} placeholder="e.g. Dolenjska, Slovenia" style={{ ...baseInp, padding: "5px 8px" }} />
                <button onClick={() => setNewWine(w => ({ ...w, byGlass: !w.byGlass }))} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                  borderColor: newWine.byGlass ? tokens.green.border : tokens.ink[4], borderRadius: 0, cursor: "pointer",
                  background: newWine.byGlass ? tokens.green.bg : tokens.neutral[0], color: newWine.byGlass ? tokens.green.text : tokens.ink[2],
                }}>{newWine.byGlass ? "YES" : "NO"}</button>
              </div>
            )}
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
