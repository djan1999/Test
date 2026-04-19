import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";

// ── InventoryPanel — Wine & beverage sync from hotel website ──
export default function InventoryPanel({ onSyncWines, wines = [] }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");
  const [lastSync, setLastSync] = useState(null);

  const handleSync = async () => {
    setStatus("syncing"); setMsg("");
    try {
      const r = await onSyncWines();
      if (r?.ok) {
        const parts = [
          r.wines != null ? `${r.wines} wines` : null,
          r.cocktails != null ? `${r.cocktails} cocktails` : null,
          r.beers != null ? `${r.beers} beers` : null,
          r.spirits != null ? `${r.spirits} spirits` : null,
        ].filter(Boolean);
        const warn = r.failedCountries?.length ? ` (missed: ${r.failedCountries.join(", ")})` : "";
        setStatus("ok"); setMsg(`${parts.join(", ")}${warn}`);
        setLastSync(new Date().toLocaleTimeString());
      } else { setStatus("err"); setMsg(r?.error || "Failed"); }
    } catch (e) { setStatus("err"); setMsg(e.message); }
  };

  const byGlassWines = wines.filter(w => w.byGlass);
  const categories = [...new Set(wines.map(w => w.country || w.category || "Other").filter(Boolean))];

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.muted, textTransform: "uppercase", marginBottom: 16 }}>
        Wine &amp; beverage sync
      </div>

      {/* Sync trigger */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <button onClick={handleSync} disabled={status === "syncing"} style={{
          fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2, padding: "10px 20px",
          border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius,
          cursor: status === "syncing" ? "not-allowed" : "pointer",
          background: tokens.charcoal.default, color: tokens.text.inverse,
        }}>
          {status === "syncing" ? "SYNCING..." : "SYNC WINES & BEVERAGES"}
        </button>
        {msg && <span style={{ fontFamily: FONT, fontSize: 10, color: status === "ok" ? tokens.green.text : tokens.red.text }}>{msg}</span>}
      </div>

      {/* Sync status */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ border: tokens.border.subtle, borderRadius: tokens.radius, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>Status</div>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.md, fontWeight: 600, color: status === "ok" ? tokens.green.text : status === "err" ? tokens.red.text : tokens.text.muted }}>
            {status === "ok" ? "Success" : status === "err" ? "Failed" : status === "syncing" ? "Syncing..." : "Idle"}
          </div>
        </div>
        <div style={{ border: tokens.border.subtle, borderRadius: tokens.radius, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>Last Sync</div>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.md, color: tokens.text.body }}>{lastSync || "—"}</div>
        </div>
        <div style={{ border: tokens.border.subtle, borderRadius: tokens.radius, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>Wines in DB</div>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.md, color: tokens.text.body }}>{wines.length}</div>
        </div>
        <div style={{ border: tokens.border.subtle, borderRadius: tokens.radius, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>By Glass</div>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.md, color: tokens.text.body }}>{byGlassWines.length}</div>
        </div>
      </div>

      {/* Imported wines summary */}
      {wines.length > 0 && (
        <div>
          <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 10 }}>
            Imported wines ({wines.length})
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", border: tokens.border.subtle, borderRadius: tokens.radius }}>
            {wines.slice(0, 100).map((w, i) => (
              <div key={w.id || i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px", borderBottom: tokens.border.subtle,
                background: i % 2 === 0 ? tokens.surface.card : tokens.surface.hover,
              }}>
                <div>
                  <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.base, fontWeight: 600, color: tokens.text.primary }}>
                    {w.producer ? `${w.producer} ` : ""}{w.name}
                  </span>
                  {w.vintage && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.text.muted, marginLeft: 6 }}>{w.vintage}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {w.byGlass && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.xs, letterSpacing: 1, color: tokens.green.text, border: `1px solid ${tokens.green.border}`, borderRadius: tokens.radius, padding: "2px 6px" }}>GLASS</span>}
                  {(w.country || w.region) && <span style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.text.muted }}>{w.region || w.country}</span>}
                </div>
              </div>
            ))}
            {wines.length > 100 && (
              <div style={{ fontFamily: FONT, fontSize: tokens.fontSize.sm, color: tokens.text.disabled, textAlign: "center", padding: 12 }}>
                + {wines.length - 100} more wines
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
