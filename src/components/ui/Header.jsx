import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";

const FONT = tokens.font;
const { ink, rule, neutral, green, red, charcoal, tint } = tokens;

export default function Header({
  appName = "MILKA",
  modeLabel,
  showAddRes = false,
  showSummary = false,
  showMenu = false,
  showArchive = false,
  showInventory = false,
  showSync = false,
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
  onEndService,
}) {
  const isMobile = useIsMobile(BP.sm);
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

  // Base action button — editorial, no-radius, mono 9px
  const btn = {
    fontFamily:    FONT,
    fontSize:      isMobile ? "10px" : "9px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight:    400,
    padding:       isMobile ? "12px 14px" : "7px 11px",
    border:        `${rule.hairline} solid ${ink[3]}`,
    borderRadius:  0,
    cursor:        "pointer",
    background:    neutral[0],
    color:         ink[1],
    flexShrink:    0,
    minHeight:     isMobile ? 44 : undefined,
    touchAction:   "manipulation",
    whiteSpace:    "nowrap",
  };

  // Sync status chip
  const syncBorder = sSt === "ok" ? green.border : sSt === "err" || sSt === "partial" ? red.border : syncLive ? green.border : ink[4];
  const syncBg     = sSt === "ok" ? green.bg    : sSt === "err" || sSt === "partial" ? red.bg    : syncLive ? green.bg    : neutral[50];
  const syncColor  = sSt === "ok" ? green.text  : sSt === "err" || sSt === "partial" ? red.text  : syncLive ? green.text  : ink[3];
  const syncText   = sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "partial" ? "⚠ PARTIAL" : sSt === "err" ? "✗ FAILED" : syncLabel;

  return (
    <div style={{
      borderBottom: `${rule.hairline} solid ${ink[4]}`,
      padding:      isMobile ? "8px 10px" : "9px 16px",
      display:      "flex",
      flexDirection:"column",
      gap:          isMobile ? 8 : 6,
      background:   neutral[0],
      position:     "sticky",
      top:          0,
      zIndex:       50,
      paddingTop:   `max(${isMobile ? 8 : 9}px, env(safe-area-inset-top))`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isMobile ? 8 : 12, flexWrap: "wrap" }}>

        {/* Left — app name + mode label */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minWidth: 0 }}>
          <span style={{
            fontFamily:    FONT,
            fontSize:      isMobile ? "11px" : "12px",
            fontWeight:    700,
            letterSpacing: "0.28em",
            color:         ink[0],
          }}>{appName}</span>

          {modeLabel && (
            <span style={{
              fontFamily:    FONT,
              fontSize:      "9px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight:    400,
              color:         ink[3],
            }}>[{modeLabel}]</span>
          )}
        </div>

        {/* Right — action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 5 : 6, flexWrap: "wrap", justifyContent: "flex-end" }}>

          {showAddRes && (
            <button onClick={onAddRes} style={{ ...btn, border: `${rule.hairline} solid ${ink[0]}`, fontWeight: 600 }}>
              [+] {isMobile ? "RES" : "NEW RES"}
            </button>
          )}

          {showSummary && (
            <button onClick={onSummary} style={btn}>SUMMARY</button>
          )}

          {showMenu && (
            <button onClick={onMenu} style={btn}>MENU</button>
          )}

          {showInventory && (
            <button onClick={onInventory} style={btn}>{isMobile ? "INV" : "INVENTORY"}</button>
          )}

          {/* Sync status chip */}
          <span style={{
            fontFamily:    FONT,
            fontSize:      isMobile ? "10px" : "9px",
            letterSpacing: "0.12em",
            padding:       isMobile ? "12px 12px" : "7px 10px",
            border:        `${rule.hairline} solid ${syncBorder}`,
            borderRadius:  0,
            background:    syncBg,
            color:         syncColor,
            fontWeight:    500,
            whiteSpace:    "nowrap",
            minHeight:     isMobile ? 44 : undefined,
            display:       "inline-flex",
            alignItems:    "center",
            cursor:        onSyncAll ? "pointer" : "default",
          }}
            onClick={onSyncAll ? handleSyncAll : undefined}
          >{syncText}</span>

          {showEndService && (
            <button onClick={onEndService} style={{
              ...btn,
              border:     `${rule.hairline} solid ${red.border}`,
              background: red.bg,
              color:      red.text,
              fontWeight: 600,
            }}>{isMobile ? "END" : "END SERVICE"}</button>
          )}

          <button onClick={onExit} style={btn}>EXIT</button>
        </div>
      </div>

      {/* Partial sync message */}
      {sMsg && (
        <div style={{
          fontFamily:  FONT,
          fontSize:    "8px",
          letterSpacing: "0.08em",
          color:       sSt === "partial" ? tokens.red.text : ink[3],
          paddingLeft: 2,
          lineHeight:  1.4,
        }}>{sMsg}</div>
      )}
    </div>
  );
}
