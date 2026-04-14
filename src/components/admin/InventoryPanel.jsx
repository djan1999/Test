import { useState } from "react";
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
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 16 }}>
        Wine &amp; beverage sync
      </div>

      {/* Sync trigger */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <button onClick={handleSync} disabled={status === "syncing"} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "10px 20px",
          border: "1px solid #9a9a9a", borderRadius: 2,
          cursor: status === "syncing" ? "not-allowed" : "pointer",
          background: "#9a9a9a", color: "#fff",
        }}>
          {status === "syncing" ? "SYNCING..." : "SYNC WINES & BEVERAGES"}
        </button>
        {msg && <span style={{ fontFamily: FONT, fontSize: 10, color: status === "ok" ? "#555" : "#333" }}>{msg}</span>}
      </div>

      {/* Sync status */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Status</div>
          <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: status === "ok" ? "#555" : status === "err" ? "#333" : "#888" }}>
            {status === "ok" ? "Success" : status === "err" ? "Failed" : status === "syncing" ? "Syncing..." : "Idle"}
          </div>
        </div>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Last Sync</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#444" }}>{lastSync || "—"}</div>
        </div>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Wines in DB</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#444" }}>{wines.length}</div>
        </div>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 140 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>By Glass</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#444" }}>{byGlassWines.length}</div>
        </div>
      </div>

      {/* Imported wines summary */}
      {wines.length > 0 && (
        <div>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 10 }}>
            Imported wines ({wines.length})
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 4 }}>
            {wines.slice(0, 100).map((w, i) => (
              <div key={w.id || i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px", borderBottom: "1px solid #f8f8f8",
                background: i % 2 === 0 ? "#fff" : "#fafafa",
              }}>
                <div>
                  <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#1a1a1a" }}>
                    {w.producer ? `${w.producer} ` : ""}{w.name}
                  </span>
                  {w.vintage && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginLeft: 6 }}>{w.vintage}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {w.byGlass && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#555", border: "1px solid #c8e8c8", borderRadius: 2, padding: "2px 6px" }}>GLASS</span>}
                  {(w.country || w.region) && <span style={{ fontFamily: FONT, fontSize: 9, color: "#aaa" }}>{w.region || w.country}</span>}
                </div>
              </div>
            ))}
            {wines.length > 100 && (
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", textAlign: "center", padding: 12 }}>
                + {wines.length - 100} more wines
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
