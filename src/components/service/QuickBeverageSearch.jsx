import { useState } from "react";
import BeverageSearch from "./BeverageSearch.jsx";
import { tokens } from "../../styles/tokens.js";

/**
 * The "everything else" escape hatch under a row of configured quick-access
 * buttons. The buttons carry what the restaurant pours every night; this
 * reaches the rest of the live catalogue without an admin trip.
 *
 * It serves both ends of the menu — the aperitif before it and the digestivo
 * inside it — so the wording is a prop. The defaults are the aperitif's,
 * because that is where the control started and where most tables use it.
 */
export default function QuickBeverageSearch({
  wines = [], cocktails = [], spirits = [], beers = [], teas = [], coffees = [], onAdd, onAddBottle,
  label = "⌕ Search all beverages",
  ariaLabel = "Search all beverages for an aperitif",
  placeholder = "find any beverage for aperitif…",
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ width: "100%", minWidth: 180 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        style={{
          fontFamily: tokens.font, fontSize: 9, letterSpacing: "0.08em",
          padding: "6px 9px", border: `1px solid ${open ? tokens.ink[1] : tokens.ink[4]}`,
          borderRadius: 0, cursor: "pointer", background: open ? tokens.tint.parchment : tokens.neutral[0],
          color: open ? tokens.ink[1] : tokens.ink[3], textTransform: "uppercase",
          touchAction: "manipulation",
        }}
      >{label}</button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <BeverageSearch
            wines={wines}
            cocktails={cocktails}
            spirits={spirits}
            beers={beers}
            teas={teas}
            coffees={coffees}
            autoFocus
            inlineResults
            placeholder={placeholder}
            onAdd={(entry) => {
              if (entry.type === "bottle") onAddBottle?.(entry.item);
              else onAdd?.(entry.item);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
