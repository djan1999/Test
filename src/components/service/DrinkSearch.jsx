import { useEffect, useRef, useState } from "react";
import { fuzzyDrink } from "../../utils/search.js";
import { tokens } from "../../styles/tokens.js";

export default function DrinkSearch({ drinkObj, list = [], onChange, placeholder, accentColor = "#7a507a" }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);
  const baseInp = {
    fontFamily: tokens.font,
    fontSize: tokens.mobileInputSize,
    padding: "10px 12px",
    border: "1px solid #e8e8e8",
    borderRadius: 0,
    outline: "none",
    color: tokens.colors.black,
    background: tokens.colors.white,
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    WebkitAppearance: "none",
  };
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {drinkObj ? (
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${accentColor}44`, borderRadius: 0, padding: "5px 28px 5px 10px", background: `${accentColor}08`, position: "relative", fontSize: 11, fontFamily: tokens.font, color: "#4a4a4a" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {drinkObj.name}
            {drinkObj.notes ? ` · ${drinkObj.notes}` : ""}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onChange(null); }} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ) : (
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            const r = fuzzyDrink(e.target.value, list);
            setResults(r);
            setOpen(r.length > 0);
            if (!e.target.value) onChange(null);
          }}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder || "search…"}
          style={{ ...baseInp, fontSize: tokens.mobileInputSize, padding: "5px 10px", letterSpacing: 0.3 }}
        />
      )}
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: "#fff", border: "1px solid #e8e8e8", borderRadius: 0, zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          {results.map((d) => (
            <div key={d.id} onMouseDown={() => { setQ(""); setOpen(false); onChange(d); }} style={{ padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5", fontFamily: tokens.font, fontSize: 12, color: "#1a1a1a" }}>
              {d.name}
              {d.notes ? <span style={{ color: "#444" }}> · {d.notes}</span> : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
