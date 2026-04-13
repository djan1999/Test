import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { UI, outlineBtn, outlineBtnGhost, primaryAction } from "../../styles/uiChrome.js";

const FONT = tokens.font;
const R = tokens.radius;

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
  const modeColor =
    modeLabel === "ADMIN" ? UI.infoText
      : modeLabel === "SERVICE" ? UI.ok
        : modeLabel === "DISPLAY" ? "#5a6a78"
          : UI.ink;
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
    color: UI.ink,
    letterSpacing: 1,
    padding: "6px 10px",
    border: `1px solid ${UI.border}`,
    borderRadius: R,
    background: UI.surface,
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, background: "#fff", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: UI.ink }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: "#e8e8e8" }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && <button onClick={onAddRes} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", borderRadius: R, cursor: "pointer", fontWeight: 600, ...primaryAction }}>+ RES</button>}
          {showSummary && <button onClick={onSummary} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", ...outlineBtn }}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", ...outlineBtn }}>MENU</button>}
          {showInventory && <button onClick={onInventory} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", ...outlineBtn }}>INVENTORY</button>}
          {showSeed && <button onClick={onSeed} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", ...outlineBtn }}>SEED TEST</button>}
          {showArchive && <button onClick={onArchive} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", ...outlineBtn }}>ARCHIVE</button>}
          {showSync && (
            <button onClick={handleSyncAll} disabled={sSt === "syncing"} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", borderRadius: R, cursor: sSt === "syncing" ? "not-allowed" : "pointer", fontWeight: 600, whiteSpace: "nowrap", opacity: sSt === "syncing" ? 0.65 : 1, ...(sSt === "ok" ? { ...primaryAction, border: `1px solid ${UI.ok}` } : sSt === "err" ? { background: UI.errSoft, color: UI.errText, border: `1px solid ${UI.errBorder}` } : outlineBtn) }}>
              {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
            </button>
          )}
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: `1px solid ${syncLive ? UI.okBorder : UI.border}`, borderRadius: R, background: syncLive ? UI.okSoft : UI.surface2, color: syncLive ? UI.okText : "#555", fontWeight: 600, whiteSpace: "nowrap" }}>{syncLabel}</span>
          {showEndService && <button onClick={onEndService} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #c04040", borderRadius: R, cursor: "pointer", background: "#fff0f0", color: "#c04040", fontWeight: 600, flexShrink: 0 }}>END SERVICE</button>}
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", borderRadius: R, cursor: "pointer", flexShrink: 0, ...outlineBtnGhost }}>EXIT</button>
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
