import { useEffect, useRef, useState } from "react";
import { fuzzy } from "../../utils/search.js";
import { tokens } from "../../styles/tokens.js";
import { useEightySix } from "../../hooks/useEightySix.js";
import { wineEightySixKey } from "../../utils/eightySix.js";

export default function WineSearch({ wineObj, wines = [], onChange, placeholder, byGlass = null, compact = false }) {
  const eightySix = useEightySix();
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
  const fs = compact ? 11 : 12;
  const inputFs = tokens.mobileInputSize;
  const py = compact ? 5 : 7;
  const baseInp = {
    fontFamily: tokens.font,
    fontSize: tokens.mobileInputSize,
    padding: "10px 12px",
    border: `1px solid ${tokens.neutral[200]}`,
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
      {wineObj ? (
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, padding: `${py}px 28px ${py}px 10px`, background: tokens.neutral[50], position: "relative", fontSize: fs, fontFamily: tokens.font, color: tokens.neutral[700] }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wineObj.name} · {wineObj.producer} · {wineObj.vintage}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onChange(null); }} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: tokens.neutral[600], cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ) : (
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            const r = fuzzy(e.target.value, wines, byGlass);
            setResults(r);
            setOpen(r.length > 0);
            if (!e.target.value) onChange(null);
          }}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder || "search…"}
          style={{ ...baseInp, fontSize: inputFs, padding: `${py}px 10px`, letterSpacing: 0.3 }}
        />
      )}
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: tokens.neutral[0], border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          {results.map((w) => {
            const is86 = eightySix.has(wineEightySixKey(w));
            return (
              <div key={w.id} onMouseDown={() => { if (is86) return; setQ(""); setOpen(false); onChange(w); }} style={{ padding: "10px 14px", cursor: is86 ? "not-allowed" : "pointer", borderBottom: `1px solid ${tokens.neutral[100]}`, display: "flex", alignItems: "center", justifyContent: "space-between", opacity: is86 ? 0.45 : 1 }}>
                <div>
                  <span style={{ fontFamily: tokens.font, fontSize: 12, color: tokens.neutral[900], textDecoration: is86 ? "line-through" : "none" }}>{w.name}</span>
                  <span style={{ fontFamily: tokens.font, fontSize: 11, color: tokens.neutral[700] }}> · {w.producer} · {w.vintage}</span>
                </div>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  {is86 && <span style={{ fontFamily: tokens.font, fontSize: 8, letterSpacing: 1, fontWeight: 700, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "2px 5px" }}>86</span>}
                  {w.byGlass && <span style={{ fontFamily: tokens.font, fontSize: 9, letterSpacing: 1, color: tokens.neutral[700], border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, padding: "2px 5px" }}>glass</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
