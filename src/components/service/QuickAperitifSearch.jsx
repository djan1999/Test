import { useState } from "react";
import BeverageSearch from "./BeverageSearch.jsx";
import { tokens } from "../../styles/tokens.js";

export default function QuickAperitifSearch({ wines = [], cocktails = [], spirits = [], beers = [], onAdd }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ width: "100%", minWidth: 180 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Search all beverages for an aperitif"
        onClick={() => setOpen((value) => !value)}
        style={{
          fontFamily: tokens.font, fontSize: 9, letterSpacing: "0.08em",
          padding: "6px 9px", border: `1px solid ${open ? tokens.ink[1] : tokens.ink[4]}`,
          borderRadius: 0, cursor: "pointer", background: open ? tokens.tint.parchment : tokens.neutral[0],
          color: open ? tokens.ink[1] : tokens.ink[3], textTransform: "uppercase",
          touchAction: "manipulation",
        }}
      >⌕ Search all beverages</button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <BeverageSearch
            wines={wines}
            cocktails={cocktails}
            spirits={spirits}
            beers={beers}
            autoFocus
            inlineResults
            placeholder="find any beverage for aperitif…"
            onAdd={(entry) => {
              onAdd?.(entry.item);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
