import { useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const R = tokens.radius.sm;

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
  const modeColor = modeLabel === "ADMIN" ? tokens.colors.adminAccent : modeLabel === "SERVICE" ? tokens.colors.serviceAccent : tokens.colors.gray700;
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
    color: tokens.colors.ink,
    letterSpacing: 1,
    padding: "6px 10px",
    border: tokens.borderSubtle,
    borderRadius: R,
    background: tokens.colors.elevated,
    whiteSpace: "nowrap",
    boxShadow: tokens.shadow.sm,
  };
  const ghostBtn = {
    fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
    border: tokens.borderSubtle, borderRadius: R, cursor: "pointer",
    background: tokens.colors.elevated, color: tokens.colors.ink, boxShadow: tokens.shadow.sm,
  };
  return (
    <div style={{
      borderBottom: tokens.borderSubtle, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10,
      background: tokens.colors.elevated, position: "sticky", top: 0, zIndex: 50,
      boxShadow: tokens.shadow.sm,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: tokens.colors.ink }}>{appName}</span>
          <span style={{ width: 1, height: 14, background: tokens.colors.gray200 }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && (
            <button
              onClick={onAddRes}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
                border: `1px solid ${tokens.colors.goldHover}`, borderRadius: R, cursor: "pointer",
                background: `linear-gradient(180deg, ${tokens.colors.gold} 0%, ${tokens.colors.goldHover} 100%)`,
                color: tokens.colors.white, fontWeight: 600, boxShadow: tokens.shadow.sm,
              }}
            >
              + RES
            </button>
          )}
          {showSummary && <button onClick={onSummary} style={ghostBtn}>SUMMARY</button>}
          {showMenu && <button onClick={onMenu} style={ghostBtn}>MENU</button>}
          {showInventory && (
            <button
              onClick={onInventory}
              style={{
                ...ghostBtn,
                border: `1px solid ${tokens.colors.blueBorder}`,
                background: tokens.colors.blueMuted,
                color: tokens.colors.blue,
              }}
            >
              INVENTORY
            </button>
          )}
          {showSeed && (
            <button
              onClick={onSeed}
              style={{
                ...ghostBtn,
                border: `1px solid ${tokens.colors.greenBorder}`,
                background: tokens.colors.greenMuted,
                color: tokens.colors.green,
              }}
            >
              SEED TEST
            </button>
          )}
          {showArchive && (
            <button
              onClick={onArchive}
              style={{
                ...ghostBtn,
                border: `1px solid ${tokens.colors.amberBorder}`,
                background: tokens.colors.amberMuted,
                color: tokens.colors.amber,
              }}
            >
              ARCHIVE
            </button>
          )}
          {showSync && (
            <button
              onClick={handleSyncAll}
              disabled={sSt === "syncing"}
              title={sMsg || undefined}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
                border: `1px solid ${sSt === "ok" ? tokens.colors.greenBorder : sSt === "partial" ? tokens.colors.amberBorder : sSt === "err" ? tokens.colors.redBorder : tokens.colors.gold}`,
                borderRadius: R,
                cursor: sSt === "syncing" ? "not-allowed" : "pointer",
                background: sSt === "ok" ? tokens.colors.greenMuted : sSt === "partial" ? tokens.colors.amberMuted : sSt === "err" ? tokens.colors.redMuted : tokens.colors.goldMuted,
                color: sSt === "ok" ? tokens.colors.serviceAccent : sSt === "partial" ? tokens.colors.amber : sSt === "err" ? tokens.colors.red : tokens.colors.amber,
                fontWeight: 600, whiteSpace: "nowrap", boxShadow: tokens.shadow.sm,
              }}
            >
              {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "partial" ? "⚠ PARTIAL" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
            </button>
          )}
          {showSync && (sSt === "err" || sSt === "partial") && sMsg && (
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: sSt === "err" ? tokens.colors.red : tokens.colors.amber, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sMsg}>
              {sMsg}
            </span>
          )}
          <span style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
            border: `1px solid ${syncLive ? tokens.colors.greenBorder : tokens.colors.gray300}`, borderRadius: R,
            background: syncLive ? tokens.colors.greenMuted : tokens.colors.panelMuted,
            color: syncLive ? tokens.colors.serviceAccent : tokens.colors.gray700,
            fontWeight: 600, whiteSpace: "nowrap", boxShadow: tokens.shadow.sm,
          }}
          >
            {syncLabel}
          </span>
          {showEndService && (
            <button
              onClick={onEndService}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
                border: `1px solid ${tokens.colors.red}`, borderRadius: R, cursor: "pointer",
                background: tokens.colors.redMuted, color: tokens.colors.red, fontWeight: 600, flexShrink: 0, boxShadow: tokens.shadow.sm,
              }}
            >
              END SERVICE
            </button>
          )}
          <button onClick={onExit} style={{ ...ghostBtn, flexShrink: 0 }}>EXIT</button>
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
