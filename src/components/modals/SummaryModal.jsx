import FullModal from "../ui/FullModal.jsx";
import { waterStyle } from "../../constants/pairings.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { COUNTRY_NAMES } from "../../constants/countries.js";
import { tokens } from "../../styles/tokens.js";
import { restrLabel } from "../../constants/dietary.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

const FONT = tokens.font;
const PAIRING_COLOR = { Wine: tokens.text.body, "Non-Alc": tokens.neutral[500], Premium: tokens.neutral[500], "Our Story": tokens.green.text };
const PAIRING_BG = { Wine: tokens.tint.parchment, "Non-Alc": tokens.neutral[50], Premium: tokens.neutral[50], "Our Story": tokens.green.bg };

export default function SummaryModal({ tables, optionalExtras = [], onClose }) {
  const isMobile = useIsMobile(640);
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
        <button onClick={copyText} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[600] }}>
          COPY TEXT
        </button>
      }
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {active.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], textAlign: "center", padding: "80px 0" }}>No active tables</div>}
        {active.map((t) => (
          <div key={t.id} style={{ border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: isMobile ? "10px 12px" : "12px 16px", background: tokens.neutral[50], borderBottom: `1px solid ${tokens.neutral[200]}`, display: "flex", gap: isMobile ? 10 : 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: isMobile ? 18 : 22, fontWeight: 300, color: tokens.neutral[900], letterSpacing: 1, lineHeight: 1 }}>{String(t.id).padStart(2, "0")}</span>
              {t.resName && <span style={{ fontFamily: FONT, fontSize: isMobile ? 13 : 14, fontWeight: 500, color: tokens.neutral[900] }}>{t.resName}</span>}
              {t.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.green.text, fontWeight: 500 }}>arr. {t.arrivedAt}</span>}
              {t.menuType && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 8px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, color: tokens.neutral[600], background: tokens.neutral[0] }}>{t.menuType}</span>}
              {t.birthday && <span style={{ fontSize: 14 }}>🎂</span>}
              {t.notes && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500], fontStyle: "italic", marginLeft: isMobile ? 0 : "auto", flexBasis: isMobile ? "100%" : "auto" }}>{t.notes}</span>}
            </div>
            <div style={{ padding: isMobile ? "6px 10px 10px" : "8px 12px 12px" }}>
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
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 4px", borderBottom: `1px solid ${tokens.neutral[100]}` }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: restr.length ? tokens.red.text : tokens.neutral[500], minWidth: 28, letterSpacing: 0.5 }}>P{s.id}</span>
                    {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 0, background: ws.bg || tokens.neutral[100], color: tokens.neutral[700], border: `1px solid ${tokens.neutral[200]}` }}>{s.water}</span>}
                    {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 0, border: `1px solid ${tokens.neutral[200]}`, color: PAIRING_COLOR[s.pairing] || tokens.neutral[600], background: PAIRING_BG[s.pairing] || tokens.neutral[50] }}>{s.pairing}</span>}
                    {extras.map((d) => {
                      const ex = s.extras[d.key] || s.extras[d.id];
                      return (
                        <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 0, border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg }}>
                          {d.name}
                          {ex?.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}
                        </span>
                      );
                    })}
                    {allBevs.map((b, i) => (
                      <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 0, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>
                        {b.label}
                      </span>
                    ))}
                    {restr.map((r, i) => (
                      <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 0, border: `1px solid ${tokens.red.border}`, color: tokens.red.text, background: tokens.red.bg }}>
                        ⚠ {restrLabel(r.note)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
            {(t.bottleWines || []).length > 0 && (
              <div style={{ padding: "10px 16px 14px", borderTop: `1px solid ${tokens.neutral[100]}`, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.neutral[400], textTransform: "uppercase", marginBottom: 2 }}>Bottles</div>
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
                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.neutral[900], textTransform: "uppercase", letterSpacing: 0.3 }}>🍾 {title}</span>
                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[500] }}>{sub}</span>}
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
