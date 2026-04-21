import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

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
  const isMobile = useIsMobile(tokens.breakpoints.md);
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
  // Mobile-tuned action button: larger tap surface, slightly bigger text.
  const actBtn = {
    fontFamily: FONT,
    fontSize: isMobile ? 12 : 11,
    letterSpacing: isMobile ? 1.5 : 2,
    padding: isMobile ? "10px 12px" : "8px 10px",
    border: tokens.border.default,
    borderRadius: 0,
    cursor: "pointer",
    background: tokens.surface.card,
    color: tokens.text.primary,
    flexShrink: 0,
    minHeight: isMobile ? tokens.mobile.touchTargetMin : 38,
  };
  return (
    <div style={{
      borderBottom: tokens.border.subtle,
      padding: isMobile ? "10px 12px" : "12px 14px",
      display: "flex", flexDirection: "column", gap: isMobile ? 8 : 10,
      background: tokens.surface.card, position: "sticky", top: 0, zIndex: 50,
      paddingTop: `max(${isMobile ? 8 : 10}px, env(safe-area-inset-top))`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isMobile ? 8 : 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 600, letterSpacing: isMobile ? 2 : 4, color: tokens.text.primary }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: tokens.neutral[300] }} />
          <span style={{ fontSize: isMobile ? 11 : 10, letterSpacing: isMobile ? 1.5 : 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && (
            <button onClick={onAddRes} style={{ ...actBtn, border: `1px solid ${tokens.charcoal.default}`, fontWeight: 600 }}>+ RES</button>
          )}
          {showSummary && <button onClick={onSummary} style={actBtn}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={actBtn}>MENU</button>}
          {showInventory && <button onClick={onInventory} style={actBtn}>{isMobile ? "INV" : "INVENTORY"}</button>}
          {showSeed && (
            <button onClick={onSeed} style={{ ...actBtn, border: `1px solid ${tokens.green.border}`, background: tokens.green.bg, color: tokens.green.text }}>
              {isMobile ? "SEED" : "SEED TEST"}
            </button>
          )}
          <span style={{
            fontFamily: FONT, fontSize: isMobile ? 11 : 10, letterSpacing: isMobile ? 1.2 : 2,
            padding: isMobile ? "10px 12px" : "8px 10px",
            border: `1px solid ${syncLive ? tokens.green.border : tokens.neutral[300]}`,
            borderRadius: 0,
            background: syncLive ? tokens.green.bg : tokens.neutral[50],
            color: syncLive ? tokens.green.text : tokens.text.muted,
            fontWeight: 600, whiteSpace: "nowrap",
            minHeight: isMobile ? tokens.mobile.touchTargetMin : 38,
            display: "inline-flex", alignItems: "center",
          }}>{syncLabel}</span>
          {showEndService && (
            <button onClick={onEndService} style={{
              ...actBtn,
              border: `1px solid ${tokens.red.border}`,
              background: tokens.red.bg,
              color: tokens.red.text,
              fontWeight: 600,
            }}>{isMobile ? "END" : "END SERVICE"}</button>
          )}
          <button onClick={onExit} style={actBtn}>EXIT</button>
        </div>
      </div>
    </div>
  );
}
