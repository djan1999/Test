import { useState, useRef } from "react";
import { tokens } from "../../styles/tokens.js";
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
      <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, color: tokens.text.muted, marginBottom: 8 }}>
        DISHES & RESTRICTIONS
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 10, color: tokens.text.muted, padding: "16px 20px",
        background: tokens.surface.hover, border: tokens.border.subtle, borderRadius: tokens.radius, marginBottom: 28,
        lineHeight: 1.6,
      }}>
        Main dish names, descriptions, dietary flags, restriction variants, course keys, and kitchen notes are managed in <strong style={{ color: tokens.text.secondary }}>Menu Layout</strong>.
        <br />
        Use the + button on each course to add restrictions and pairings.
      </div>

      {/* Extra Dishes */}
      <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.muted, marginBottom: 16, textTransform: "uppercase" }}>
        Extra Dishes
      </div>
      <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, marginBottom: 16 }}>
        Optional courses offered to guests (beetroot, cheese, cake, etc.)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {localDishes.map(dish => (
          <div key={dish.id} style={{ border: tokens.border.subtle, borderRadius: tokens.radius, padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input value={dish.name} onChange={e => updDishName(dish.id, e.target.value)} style={{ ...baseInp, fontWeight: 500, flex: 1 }} />
              <button onClick={() => removeDish(dish.id)} style={{ background: "none", border: tokens.border.danger, borderRadius: tokens.radius, color: tokens.red.text, cursor: "pointer", fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 10px" }}>REMOVE</button>
            </div>
            <div style={{ ...fieldLabel, marginBottom: 8 }}>Pairing options</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {dish.pairings.map((p, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input value={p} onChange={e => updPairing(dish.id, idx, e.target.value)}
                    style={{ fontFamily: FONT, fontSize: tokens.fontSize.base, padding: "4px 8px", border: tokens.border.subtle, borderRadius: tokens.radius, width: 80, outline: "none", color: tokens.text.primary, background: tokens.surface.hover }} />
                  {dish.pairings.length > 1 && (
                    <button onClick={() => removePairing(dish.id, idx)} style={{ background: "none", border: "none", color: tokens.text.secondary, cursor: "pointer", fontSize: tokens.fontSize.lg, lineHeight: 1, padding: 0 }}>x</button>
                  )}
                </div>
              ))}
              <button onClick={() => addPairing(dish.id)} style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "4px 9px", border: tokens.border.subtle, borderRadius: tokens.radius, cursor: "pointer", background: tokens.surface.card, color: tokens.text.body }}> + option</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: tokens.border.subtle, paddingTop: 18 }}>
        <div style={fieldLabel}>Add dish</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newDishName} onChange={e => setNewDishName(e.target.value)} onKeyDown={e => e.key === "Enter" && addDish()} placeholder="Dish name..." style={{ ...baseInp, flex: 1 }} />
          <button onClick={addDish} style={{ ...primaryBtn, whiteSpace: "nowrap" }}>+ ADD</button>
        </div>
      </div>
      <div style={{ borderTop: tokens.border.subtle, marginTop: 24, paddingTop: 14 }}>
        <button onClick={() => onUpdateDishes(localDishes)} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
          border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius, cursor: "pointer", background: tokens.charcoal.default, color: tokens.text.inverse,
        }}>SAVE EXTRAS</button>
      </div>
    </>
  );
}
