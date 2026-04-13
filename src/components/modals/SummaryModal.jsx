import FullModal from "../ui/FullModal.jsx";
import { waterStyle, pairingStyle, PAIRINGS } from "../../constants/pairings.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { COUNTRY_NAMES } from "../../constants/countries.js";
import { tokens } from "../../styles/tokens.js";
import { UI, toggleOn } from "../../styles/uiChrome.js";
import { restrLabel } from "../../constants/dietary.js";

const FONT = tokens.font;
const PAIRING_COLOR = Object.fromEntries(PAIRINGS.map((k) => [k, pairingStyle[k].color]));
const PAIRING_BG = Object.fromEntries(PAIRINGS.map((k) => [k, pairingStyle[k].bg]));

export default function SummaryModal({ tables, optionalExtras = [], onClose }) {
  const active = tables.filter((t) => t.active || t.arrivedAt);

  const copyText = () => {
    const lines = [];
    active.forEach((t) => {
      lines.push(`TABLE ${String(t.id).padStart(2, "0")}${t.resName ? " · " + t.resName : ""}${t.arrivedAt ? " [arr. " + t.arrivedAt + "]" : ""}`);
      if (t.menuType) lines.push(`  Menu: ${t.menuType}`);
      t.seats.forEach((s) => {
        const parts = [`P${s.id}`];
        if (s.water && s.water !== "—") parts.push(`water:${s.water}`);
        if (s.pairing) parts.push(s.pairing);
        const ap = (s.aperitifs || []).map((x) => x?.name).filter(Boolean);
        const gs = (s.glasses || []).map((w) => w?.name).filter(Boolean);
        const cs = (s.cocktails || []).map((c) => c?.name).filter(Boolean);
        const sp = (s.spirits || []).map((x) => x?.name).filter(Boolean);
        const bs = (s.beers || []).map((x) => x?.name).filter(Boolean);
        if (ap.length) parts.push("aperitif:" + ap.join(","));
        if (gs.length) parts.push("glass:" + gs.join(","));
        if (cs.length) parts.push("cocktail:" + cs.join(","));
        if (sp.length) parts.push("spirit:" + sp.join(","));
        if (bs.length) parts.push("beer:" + bs.join(","));
        const extras = optionalExtras.filter((d) => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
        if (extras.length) parts.push(extras.map((d) => d.name).join(","));
        const restr = (t.restrictions || []).filter((r) => r.pos === s.id);
        if (restr.length) parts.push("⚠" + restr.map((r) => r.note).join(","));
        lines.push("  " + parts.join(" | "));
      });
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
  };

  return (
    <FullModal
      title="Service Summary"
      onClose={onClose}
      actions={
        <button onClick={copyText} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#555" }}>
          COPY TEXT
        </button>
      }
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {active.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", padding: "80px 0" }}>No active tables</div>}
        {active.map((t) => (
          <div key={t.id} style={{ border: "1px solid #f0f0f0", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "12px 16px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 300, color: "#1a1a1a", letterSpacing: 1, lineHeight: 1 }}>{String(t.id).padStart(2, "0")}</span>
              {t.resName && <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: "#1a1a1a" }}>{t.resName}</span>}
              {t.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, color: "#4a9a6a", fontWeight: 500 }}>arr. {t.arrivedAt}</span>}
              {t.menuType && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 8px", border: "1px solid #e0e0e0", borderRadius: 2, color: "#555", background: "#fff" }}>{t.menuType}</span>}
              {t.birthday && <span style={{ fontSize: 14 }}>🎂</span>}
              {t.notes && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", fontStyle: "italic", marginLeft: "auto" }}>{t.notes}</span>}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              {t.seats.map((s) => {
                const ws = waterStyle(s.water);
                const restr = (t.restrictions || []).filter((r) => r.pos === s.id);
                const extras = optionalExtras.filter((d) => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
                const allBevs = [
                  ...(s.aperitifs || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                  ...(s.glasses || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.wine })),
                  ...(s.cocktails || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                  ...(s.spirits || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.spirit })),
                  ...(s.beers || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.beer })),
                ];
                return (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 4px", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: restr.length ? "#b04040" : "#999", minWidth: 28, letterSpacing: 0.5 }}>P{s.id}</span>
                    {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, background: ws.bg || "#f5f5f5", color: ws.color || "#333", border: `1px solid ${ws.border || "#e0e0e0"}` }}>{s.water}</span>}
                    {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, border: `1px solid ${pairingStyle[s.pairing]?.border || "#e0e0e0"}`, color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa" }}>{s.pairing}</span>}
                    {extras.map((d) => {
                      const ex = s.extras[d.key] || s.extras[d.id];
                      return (
                        <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: tokens.radius, ...toggleOn }}>
                          {d.name}
                          {ex?.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}
                        </span>
                      );
                    })}
                    {allBevs.map((b, i) => (
                      <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>
                        {b.label}
                      </span>
                    ))}
                    {restr.map((r, i) => (
                      <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>
                        ⚠ {restrLabel(r.note)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
            {(t.bottleWines || []).length > 0 && (
              <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #f5f5f5", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 2 }}>Bottles</div>
                {(t.bottleWines || []).map((w, i) => {
                  const rawVintage = String(w?.vintage || "").trim();
                  const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                  const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                  const rawCountry = w?.country || "";
                  const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                  const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                  const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: 0.3 }}>🍾 {title}</span>
                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </FullModal>
  );
}
