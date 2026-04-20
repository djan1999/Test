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
  const modeColor = modeLabel === "ADMIN" ? tokens.text.secondary : modeLabel === "SERVICE" ? tokens.green.text : tokens.text.muted;
  const [sSt, setSSt] = useState(null);
  const [sMsg, setSMsg] = useState("");
  const handleSyncAll = async () => {
    if (!onSyncAll || sSt === "syncing") return;
    setSSt("syncing");
    setSMsg("");
    try {
      const r = await onSyncAll();
      console.log("[Sync]", r);
      if (r?.ok && r.partial) {
        const parts = [];
        if (r.failedCountries?.length) parts.push(`wines: ${r.failedCountries.join(", ")}`);
        if (r.failedBeveragePages?.length) parts.push(`pages: ${r.failedBeveragePages.join(", ")}`);
        setSMsg(parts.join(" • "));
        setSSt("partial");
      } else if (r?.ok) {
        setSSt("ok");
      } else {
        setSMsg(r?.error || "Unknown error");
        setSSt("err");
      }
    } catch (e) {
      console.error("[Sync] threw:", e);
      setSMsg(e?.message || "Request failed");
      setSSt("err");
    }
    setTimeout(() => { setSSt(null); setSMsg(""); }, 6000);
  };
  const topStatChip = {
    fontFamily: FONT,
    fontSize: 10,
    color: tokens.text.primary,
    letterSpacing: 1,
    padding: "6px 10px",
    border: tokens.border.default,
    borderRadius: 0,
    background: tokens.surface.card,
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ borderBottom: tokens.border.subtle, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, background: tokens.surface.card, position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: tokens.text.primary }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: tokens.neutral[300] }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && <button onClick={onAddRes} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary, fontWeight: 600 }}>+ RES</button>}
          {showSummary && <button onClick={onSummary} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: tokens.border.default, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary }}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: tokens.border.default, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary }}>MENU</button>}
          {showInventory && <button onClick={onInventory} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: tokens.border.default, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary }}>INVENTORY</button>}
          {showSeed && <button onClick={onSeed} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer", background: tokens.green.bg, color: tokens.green.text }}>SEED TEST</button>}
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: `1px solid ${syncLive ? tokens.green.border : tokens.neutral[300]}`, borderRadius: 0, background: syncLive ? tokens.green.bg : tokens.neutral[50], color: syncLive ? tokens.green.text : tokens.text.muted, fontWeight: 600, whiteSpace: "nowrap" }}>{syncLabel}</span>
          {showEndService && <button onClick={onEndService} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.red.bg, color: tokens.red.text, fontWeight: 600, flexShrink: 0 }}>END SERVICE</button>}
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: tokens.border.default, borderRadius: 0, cursor: "pointer", background: tokens.surface.card, color: tokens.text.primary, flexShrink: 0 }}>EXIT</button>
        </div>
      </div>
    </div>
  );
}
