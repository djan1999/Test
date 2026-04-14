import { useState, useRef } from "react";
import { FONT, baseInp, fieldLabel, primaryBtn } from "./adminStyles.js";

// ── DishesPanel — manage dishes and restrictions ──
// Contains:
//   - Main Dishes: course-level dish info is managed in Menu Layout
//   - Extra Dishes: optional courses offered to guests (beetroot, cheese, cake, etc.)
export default function DishesPanel({ dishes, onUpdateDishes }) {
  const [localDishes, setLocalDishes] = useState(
    dishes.map(d => ({ ...d, pairings: [...d.pairings] }))
  );
  const [newDishName, setNewDishName] = useState("");
  const nextDishId = useRef(Math.max(...dishes.map(d => d.id), 0) + 1);

  const addDish = () => {
    if (!newDishName.trim()) return;
    setLocalDishes(l => [...l, { id: nextDishId.current++, name: newDishName.trim(), pairings: ["\u2014", "Wine", "Non-Alc"] }]);
    setNewDishName("");
  };
  const removeDish    = id         => setLocalDishes(l => l.filter(d => d.id !== id));
  const updDishName   = (id, v)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, name: v } : d));
  const addPairing    = id         => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: [...d.pairings, ""] } : d));
  const updPairing    = (id, i, v) => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.map((p, idx) => idx === i ? v : p) } : d));
  const removePairing = (id, i)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.filter((_, idx) => idx !== i) } : d));

  return (
    <>
      {/* Main Dishes info */}
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 8 }}>
        DISHES & RESTRICTIONS
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 10, color: "#aaa", padding: "16px 20px",
        background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 4, marginBottom: 28,
        lineHeight: 1.6,
      }}>
        Main dish names, descriptions, dietary flags, restriction variants, course keys, and kitchen notes are managed in <strong style={{ color: "#1a1a1a" }}>Menu Layout</strong>.
        <br />
        Use the + button on each course to add restrictions and pairings.
      </div>

      {/* Extra Dishes */}
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", marginBottom: 16, textTransform: "uppercase" }}>
        Extra Dishes
      </div>
      <div style={{ fontFamily: FONT, fontSize: 10, color: "#aaa", marginBottom: 16 }}>
        Optional courses offered to guests (beetroot, cheese, cake, etc.)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {localDishes.map(dish => (
          <div key={dish.id} style={{ border: "1px solid #f0f0f0", borderRadius: 2, padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input value={dish.name} onChange={e => updDishName(dish.id, e.target.value)} style={{ ...baseInp, fontWeight: 500, flex: 1 }} />
              <button onClick={() => removeDish(dish.id)} style={{ background: "none", border: "1px solid #e0e0e0", borderRadius: 2, color: "#e07070", cursor: "pointer", fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px" }}>REMOVE</button>
            </div>
            <div style={{ ...fieldLabel, marginBottom: 8 }}>Pairing options</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {dish.pairings.map((p, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input value={p} onChange={e => updPairing(dish.id, idx, e.target.value)}
                    style={{ fontFamily: FONT, fontSize: 11, padding: "4px 8px", border: "1px solid #e8e8e8", borderRadius: 2, width: 80, outline: "none", color: "#1a1a1a", background: "#fafafa" }} />
                  {dish.pairings.length > 1 && (
                    <button onClick={() => removePairing(dish.id, idx)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>x</button>
                  )}
                </div>
              ))}
              <button onClick={() => addPairing(dish.id)} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 9px", border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#444" }}>+ option</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 18 }}>
        <div style={fieldLabel}>Add dish</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newDishName} onChange={e => setNewDishName(e.target.value)} onKeyDown={e => e.key === "Enter" && addDish()} placeholder="Dish name..." style={{ ...baseInp, flex: 1 }} />
          <button onClick={addDish} style={{ ...primaryBtn, whiteSpace: "nowrap" }}>+ ADD</button>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 24, paddingTop: 14 }}>
        <button onClick={() => onUpdateDishes(localDishes)} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
        }}>SAVE EXTRAS</button>
      </div>
    </>
  );
}
