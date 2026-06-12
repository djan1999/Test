import { useMemo, useState } from "react";
import FullModal from "../ui/FullModal.jsx";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { tokens } from "../../styles/tokens.js";
import {
  eightySixKeyFor, dishEightySixKey, wineEightySixKey, eightySixKeyLabel,
} from "../../utils/eightySix.js";

const FONT = tokens.font;

/**
 * 86 board — mark dishes and drinks out of stock mid-service.
 * Searching shows everything sellable; tapping an item toggles its
 * availability. Changes save immediately and sync to every device:
 * 86'd items grey out in search results, quick-access buttons and
 * the optional-extras toggles.
 */
export default function EightySixPanel({
  wines = [], cocktails = [], spirits = [], beers = [], dishes = [],
  keys = [], onSave, onClose,
}) {
  const [q, setQ] = useState("");
  const keySet = useMemo(() => new Set(keys), [keys]);

  // One flat catalogue of everything that can be 86'd.
  const catalogue = useMemo(() => {
    const out = [];
    wines.forEach(w => out.push({
      key: wineEightySixKey(w), type: "wine",
      label: w.name, sub: [w.producer, w.vintage].filter(Boolean).join(" · "),
    }));
    cocktails.forEach(c => out.push({ key: eightySixKeyFor("cocktail", c), type: "cocktail", label: c.name, sub: c.notes || "" }));
    spirits.forEach(s => out.push({ key: eightySixKeyFor("spirit", s), type: "spirit", label: s.name, sub: s.notes || "" }));
    beers.forEach(b => out.push({ key: eightySixKeyFor("beer", b), type: "beer", label: b.name, sub: b.notes || "" }));
    dishes.forEach(d => out.push({ key: dishEightySixKey(d.key), type: "dish", label: d.label || d.key, sub: "dish" }));
    return out;
  }, [wines, cocktails, spirits, beers, dishes]);

  const byKey = useMemo(() => new Map(catalogue.map(c => [c.key, c])), [catalogue]);

  const results = useMemo(() => {
    const lq = q.trim().toLowerCase();
    if (!lq) return [];
    return catalogue
      .filter(c => c.label?.toLowerCase().includes(lq) || c.sub?.toLowerCase().includes(lq))
      .slice(0, 12);
  }, [q, catalogue]);

  const toggle = (key) => {
    const next = keySet.has(key) ? keys.filter(k => k !== key) : [...keys, key];
    onSave(next);
  };

  const typeBadge = (type) => {
    const ts = BEV_TYPES[type] || { label: type, color: tokens.neutral[700], bg: tokens.neutral[50], border: tokens.neutral[200] };
    return (
      <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, fontWeight: 600, padding: "2px 6px", color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, flexShrink: 0, textTransform: "uppercase" }}>
        {ts.label || type}
      </span>
    );
  };

  return (
    <FullModal title="86 · Out of stock" onClose={onClose}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500], background: tokens.neutral[50], padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
          Out of something? Mark it here — it greys out on every device until you restore it.
        </div>

        {keys.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.red.text, textTransform: "uppercase", marginBottom: 8 }}>
              Currently 86'd ({keys.length})
            </div>
            {keys.map(key => {
              const item = byKey.get(key);
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1px solid ${tokens.red.border}`, background: tokens.red.bg, marginBottom: 6 }}>
                  {item ? typeBadge(item.type) : typeBadge("dish")}
                  <span style={{ fontFamily: FONT, fontSize: 12, color: tokens.neutral[900], flex: 1, textDecoration: "line-through" }}>
                    {item ? item.label : eightySixKeyLabel(key)}
                    {item?.sub ? <span style={{ fontSize: 10, color: tokens.neutral[500], textDecoration: "none" }}> · {item.sub}</span> : null}
                  </span>
                  <button onClick={() => toggle(key)} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "5px 12px",
                    border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0], color: tokens.green.text, textTransform: "uppercase",
                  }}>Restore</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[500], textTransform: "uppercase", marginBottom: 8 }}>
          Mark something 86
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="search dishes & drinks…"
          autoComplete="off"
          style={{
            fontFamily: FONT, fontSize: tokens.mobileInputSize, padding: "10px 12px", width: "100%",
            border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, outline: "none",
            boxSizing: "border-box", WebkitAppearance: "none",
          }}
        />
        <div style={{ marginTop: 8 }}>
          {results.map(r => {
            const is86 = keySet.has(r.key);
            return (
              <div key={r.key} onClick={() => toggle(r.key)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer",
                borderBottom: `1px solid ${tokens.neutral[50]}`, opacity: is86 ? 0.45 : 1, userSelect: "none",
              }}>
                {typeBadge(r.type)}
                <span style={{ fontFamily: FONT, fontSize: 12, color: tokens.neutral[900], flex: 1, textDecoration: is86 ? "line-through" : "none" }}>{r.label}</span>
                {r.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500] }}>{r.sub}</span>}
                <span style={{
                  fontFamily: FONT, fontSize: 8, letterSpacing: 1, fontWeight: 700, padding: "3px 8px",
                  color: is86 ? tokens.green.text : tokens.red.text,
                  border: `1px solid ${is86 ? tokens.green.border : tokens.red.border}`,
                  background: tokens.neutral[0],
                }}>{is86 ? "RESTORE" : "86 IT"}</span>
              </div>
            );
          })}
          {q.trim() && results.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[400], fontStyle: "italic", padding: "12px 0" }}>
              Nothing matches "{q.trim()}".
            </div>
          )}
        </div>
      </div>
    </FullModal>
  );
}
