import { useEffect, useRef, useState } from "react";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { tokens } from "../../styles/tokens.js";

export default function BeverageSearch({ wines, cocktails, spirits, beers, onAdd }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const inputRef = useRef();

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

  const search = (val) => {
    if (!val.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const lq = val.toLowerCase();
    const r = [];
    wines.forEach((w) => {
      if (w.name.toLowerCase().includes(lq) || w.producer?.toLowerCase().includes(lq) || w.vintage?.includes(lq)) {
        r.push({ type: w.byGlass ? "wine" : "bottle", item: w, label: w.name, sub: `${w.producer} · ${w.vintage}` });
      }
    });
    cocktails.forEach((c) => {
      if (c.name.toLowerCase().includes(lq) || (c.notes || "").toLowerCase().includes(lq)) {
        r.push({ type: "cocktail", item: c, label: c.name, sub: c.notes || "" });
      }
    });
    spirits.forEach((s) => {
      if (s.name.toLowerCase().includes(lq) || (s.notes || "").toLowerCase().includes(lq)) {
        r.push({ type: "spirit", item: s, label: s.name, sub: s.notes || "" });
      }
    });
    beers.forEach((b) => {
      if (b.name.toLowerCase().includes(lq) || (b.notes || "").toLowerCase().includes(lq)) {
        r.push({ type: "beer", item: b, label: b.name, sub: b.notes || "" });
      }
    });
    setResults(r.slice(0, 10));
    setOpen(r.length > 0);
  };

  const handleAdd = (entry) => {
    onAdd(entry);
    setQ("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => results.length && setOpen(true)}
        placeholder="search beverages…"
        autoComplete="off"
        style={{ ...baseInp, fontSize: tokens.mobileInputSize, padding: "9px 12px", letterSpacing: 0.3 }}
      />
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: tokens.neutral[0], border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, zIndex: 300, boxShadow: "0 6px 24px rgba(0,0,0,0.10)", overflow: "hidden" }}>
          {results.map((r, i) => {
            const ts = BEV_TYPES[r.type];
            return (
              <div key={i} onMouseDown={() => handleAdd(r)} onTouchEnd={(e) => { e.preventDefault(); handleAdd(r); }} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${tokens.neutral[50]}`, display: "flex", alignItems: "center", gap: 10, background: tokens.neutral[0], touchAction: "manipulation", userSelect: "none" }}>
                <span style={{ fontFamily: tokens.font, fontSize: 8, letterSpacing: 1, fontWeight: 600, padding: "2px 6px", borderRadius: 0, color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, flexShrink: 0, textTransform: "uppercase" }}>{ts.label}</span>
                <span style={{ fontFamily: tokens.font, fontSize: 12, color: tokens.neutral[900], flex: 1 }}>{r.label}</span>
                {r.sub && <span style={{ fontFamily: tokens.font, fontSize: 11, color: tokens.neutral[500] }}>{r.sub}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
