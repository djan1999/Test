import FullModal from "../ui/FullModal.jsx";
import TableSummaryCard from "./TableSummaryCard.jsx";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

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
        <button onClick={copyText} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[600] }}>
          COPY TEXT
        </button>
      }
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {active.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], textAlign: "center", padding: "80px 0" }}>No active tables</div>}
        {active.map((t) => (
          <TableSummaryCard key={t.id} table={t} optionalExtras={optionalExtras} />
        ))}
      </div>
    </FullModal>
  );
}
