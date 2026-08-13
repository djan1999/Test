import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { useClock, formatClock } from "../../hooks/useClock.js";
import { PRODUCT_NAME } from "../../config/product.js";

const FONT = tokens.font;
const { ink, rule, neutral, green, red, charcoal, tint } = tokens;

// The clock is its own component so its per-minute tick re-renders four
// characters instead of the whole bar (and so headers without a clock run no
// timer at all — the hook only mounts where it is asked for).
function Clock({ isMobile }) {
  const now = useClock();
  const time = formatClock(now);

  return (
    <time
      dateTime={time}
      aria-label={`Time ${time}`}
      style={{
        fontFamily:        FONT,
        fontSize:          isMobile ? "15px" : "16px",
        fontWeight:        500,
        letterSpacing:     "0.06em",
        fontVariantNumeric: "tabular-nums",
        color:             ink[0],
        whiteSpace:        "nowrap",
        flexShrink:        0,
        // Reads as a value, not a control: no border, no fill, and out of the
        // tap targets it sits beside.
        padding:           isMobile ? "0 2px" : "0 4px",
        pointerEvents:     "none",
      }}
    >{time}</time>
  );
}

export default function Header({
  appName = PRODUCT_NAME,
  modeLabel,
  showAddRes = false,
  showSummary = false,
  showMenu = false,
  showArchive = false,
  showInventory = false,
  showSync = false,
  showEndService = false,
  // Live wall clock in the bar (kitchen). The pass has no other clock in
  // view once a panel is running full-screen, and every timing call — how
  // long a ticket has been up, when the next party lands — is made against it.
  showClock = false,
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
  onEndService,
  // Opens the device-health readout (the support answer). The STATUS CHIP is
  // its entry point (owner choice, 14.08): tapping the chip asks "is this
  // device okay?" — the one question everyone actually has when they look at
  // it. The chip no longer runs the wine-catalogue sync; that lives on the
  // admin's login screen. Optional: when absent the chip has no tap at all.
  onOpenHealth = null,
  // Compact in-header view switch, rendered next to the logo. On the 720px
  // kitchen panel a separate toggle row cost a whole row of ticket space —
  // { options: [[key, label], …], active, onChange }.
  viewSwitch = null,
}) {
  const isMobile = useIsMobile(BP.sm);

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
  const syncBorder = syncLive ? green.border : ink[4];
  const syncBg     = syncLive ? green.bg     : neutral[50];
  const syncColor  = syncLive ? green.text   : ink[3];
  const syncText   = syncLabel;

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

          {viewSwitch && (
            <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
              {viewSwitch.options.map(([key, label]) => {
                const on = viewSwitch.active === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => viewSwitch.onChange(key)}
                    style={{
                      fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em",
                      textTransform: "uppercase", fontWeight: on ? 600 : 400,
                      padding: isMobile ? "8px 10px" : "5px 10px", marginLeft: -1,
                      border: `1px solid ${on ? charcoal.default : ink[4]}`,
                      background: on ? charcoal.default : neutral[0],
                      color: on ? neutral[0] : ink[2],
                      borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — clock, then action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 5 : 6, flexWrap: "wrap", justifyContent: "flex-end" }}>

          {showClock && <Clock isMobile={isMobile} />}

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

          {showArchive && (
            <button onClick={onArchive} style={btn}>{isMobile ? "ARCH" : "ARCHIVE"}</button>
          )}

          {/* Sync status chip — tapping it opens the device-health readout
              (the support answer), on every role including Kitchen. */}
          <span
            role={onOpenHealth ? "button" : undefined}
            aria-label={onOpenHealth ? "Device health" : undefined}
            title={onOpenHealth ? "Device health" : undefined}
            style={{
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
              cursor:        onOpenHealth ? "pointer" : "default",
              touchAction:   "manipulation",
            }}
            onClick={onOpenHealth || undefined}
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
    </div>
  );
}
