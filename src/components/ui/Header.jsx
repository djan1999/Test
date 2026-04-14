import { useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

export default function Header({
  appName = "MILKA",
  modeLabel,
  showAddRes = false,
  showSummary = false,
  showMenu = false,
  showArchive = false,
  showInventory = false,
  showSync = false,
  showSeed = false,
  showEndService = false,
  syncLabel,
  syncLive,
  activeCount,
  reserved,
  seated,
  onExit,
  onMenu,
  onSummary,
  onArchive,
  onAddRes,
  onInventory,
  onSyncAll,
  onSeed,
  onEndService,
}) {
  const modeColor = modeLabel === "ADMIN" ? "#4b4b88" : modeLabel === "SERVICE" ? "#2f7a45" : "#555";
  const [sSt, setSSt] = useState(null);
  const handleSyncAll = async () => {
    if (!onSyncAll || sSt === "syncing") return;
    setSSt("syncing");
    try {
      const r = await onSyncAll();
      console.log("[Sync]", r);
      setSSt(r?.ok ? "ok" : "err");
    } catch (e) {
      console.error("[Sync] threw:", e);
      setSSt("err");
    }
    setTimeout(() => setSSt(null), 3000);
  };
  const topStatChip = {
    fontFamily: FONT,
    fontSize: 10,
    color: "#1a1a1a",
    letterSpacing: 1,
    padding: "6px 10px",
    border: "1px solid #e8e8e8",
    borderRadius: 999,
    background: "#fff",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, background: "#fff", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: "#1a1a1a" }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: "#e8e8e8" }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && <button onClick={onAddRes} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #1a1a1a", borderRadius: 999, cursor: "pointer", background: "#1a1a1a", color: "#fff", fontWeight: 600 }}>+ RES</button>}
          {showSummary && <button onClick={onSummary} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a" }}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a" }}>MENU</button>}
          {showInventory && <button onClick={onInventory} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #c8d8e8", borderRadius: 999, cursor: "pointer", background: "#f0f6ff", color: "#3060a0" }}>INVENTORY</button>}
          {showSeed && <button onClick={onSeed} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #b0d8b0", borderRadius: 999, cursor: "pointer", background: "#f0fbf0", color: "#307030" }}>SEED TEST</button>}
          {showArchive && <button onClick={onArchive} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8d8b8", borderRadius: 999, cursor: "pointer", background: "#fff8f0", color: "#8a6030" }}>ARCHIVE</button>}
          {showSync && (
            <button onClick={handleSyncAll} disabled={sSt === "syncing"} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: `1px solid ${sSt === "ok" ? "#8fc39f" : sSt === "err" ? "#e89898" : "#c8a96e"}`, borderRadius: 999, cursor: sSt === "syncing" ? "not-allowed" : "pointer", background: sSt === "ok" ? "#eef8f1" : sSt === "err" ? "#fff0f0" : "#fffaf4", color: sSt === "ok" ? "#2f7a45" : sSt === "err" ? "#c04040" : "#8a6020", fontWeight: 600, whiteSpace: "nowrap" }}>
              {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
            </button>
          )}
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: `1px solid ${syncLive ? "#8fc39f" : "#d8d8d8"}`, borderRadius: 999, background: syncLive ? "#eef8f1" : "#f6f6f6", color: syncLive ? "#2f7a45" : "#555", fontWeight: 600, whiteSpace: "nowrap" }}>{syncLabel}</span>
          {showEndService && <button onClick={onEndService} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #c04040", borderRadius: 999, cursor: "pointer", background: "#fff0f0", color: "#c04040", fontWeight: 600, flexShrink: 0 }}>END SERVICE</button>}
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a", flexShrink: 0 }}>EXIT</button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={topStatChip}>{activeCount} seated</span>
        <span style={topStatChip}>{reserved} reserved</span>
        <span style={topStatChip}>{seated} guests</span>
      </div>
    </div>
  );
}
