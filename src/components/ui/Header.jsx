import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { appBarStyle, ghostPillStyle, primaryPillStyle, syncControlStyle, livePillStyle } from "../../styles/ui.js";

const FONT = tokens.font;
const c = tokens.colors;

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
  const modeColor = c.gray750;
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
    color: c.text,
    letterSpacing: 1,
    padding: "6px 10px",
    border: `1px solid ${c.line}`,
    borderRadius: tokens.radius.pill,
    background: c.white,
    whiteSpace: "nowrap",
  };
  return (
    <div style={appBarStyle()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: c.text }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: c.line }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && <button onClick={onAddRes} style={primaryPillStyle()}>+ RES</button>}
          {showSummary && <button onClick={onSummary} style={ghostPillStyle()}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={ghostPillStyle()}>MENU</button>}
          {showInventory && <button onClick={onInventory} style={ghostPillStyle()}>INVENTORY</button>}
          {showSeed && <button onClick={onSeed} style={ghostPillStyle()}>SEED TEST</button>}
          {showArchive && <button onClick={onArchive} style={ghostPillStyle()}>ARCHIVE</button>}
          {showSync && (
            <button onClick={handleSyncAll} disabled={sSt === "syncing"} style={syncControlStyle(sSt)}>
              {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
            </button>
          )}
          <span style={livePillStyle(syncLive)}>{syncLabel}</span>
          {showEndService && (
            <button
              onClick={onEndService}
              style={{
                ...ghostPillStyle(),
                border: `1px solid ${c.gray850}`,
                background: c.gray75,
                color: c.gray850,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              END SERVICE
            </button>
          )}
          <button onClick={onExit} style={{ ...ghostPillStyle(), flexShrink: 0 }}>EXIT</button>
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
