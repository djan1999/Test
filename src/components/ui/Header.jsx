import { useState } from "react";
import { tokens } from "../../styles/tokens.js";

const { ink, signal, typeScale, space, rule, font } = tokens;

// Derive rgba from a token hex value — keeps zero hardcoded hex in this file.
function alpha(hexToken, opacity) {
  const h = hexToken.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// Shorthand: off-white (ink.bg) at a given opacity — text on near-black bg
const canvas = (o) => alpha(ink.bg, o);
// Shorthand: rule separator colour (ink[4]) at a given opacity
const sep    = (o) => alpha(ink[4], o);

// Ghost button for dark background — shared base, callers may override border/color
const ghostBase = {
  fontFamily: font,
  ...typeScale.label,
  padding:      `${space[1]} ${space[3]}`,
  border:       `${rule.hairline} solid ${sep(0.22)}`,
  borderRadius: 0,
  cursor:       'pointer',
  background:   'none',
  color:        canvas(0.70),
  whiteSpace:   'nowrap',
  flexShrink:   0,
};

export default function Header({
  appName       = "MILKA",
  modeLabel,
  showAddRes    = false,
  showSummary   = false,
  showMenu      = false,
  showArchive   = false,
  showInventory = false,
  showSync      = false,
  showSeed      = false,
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
  // ── Cockpit zone extras ────────────────────────────────────────
  // All optional — null/false defaults so App.jsx needs no immediate changes.
  // Populate these once App.jsx refactor lands.
  serviceDate    = null,   // e.g. "19.04.26"
  serviceName    = null,   // e.g. "DINNER"
  hasAllergyFlag = false,  // true → alert dot appears after table count
}) {
  const [sSt,  setSSt]  = useState(null);
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
        if (r.failedCountries?.length)     parts.push(`wines: ${r.failedCountries.join(", ")}`);
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

  const hasCoverData = activeCount != null || seated != null;

  return (
    <div style={{
      backgroundColor: ink[0],
      padding:         `0 ${space[4]}`,
      minHeight:       '48px',
      display:         'flex',
      alignItems:      'center',
      gap:             space[3],
      position:        'sticky',
      top:             0,
      zIndex:          50,
      fontFamily:      font,
      flexWrap:        'nowrap',
      overflowX:       'visible',
    }}>

      {/* ── LEFT — MILKA / SERVICE ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexShrink: 0 }}>
        <span style={{ ...typeScale.label, fontFamily: font, color: canvas(0.40) }}>
          {appName}
        </span>
        <span style={{ width: rule.hairline, height: '12px', background: sep(0.30), flexShrink: 0 }} />
        <span style={{ ...typeScale.meta, fontFamily: font, color: canvas(0.90) }}>
          {modeLabel || 'SERVICE'}
        </span>
      </div>

      {/* ── CENTER — date / service name (grows to fill, centered) */}
      <div style={{
        flex:       1,
        minWidth:   0,
        textAlign:  'center',
        overflow:   'hidden',
        ...typeScale.meta,
        fontFamily: font,
        color:      canvas(0.70),
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}>
        {[serviceDate, serviceName].filter(Boolean).join(' / ')}
      </div>

      {/* ── RIGHT — action buttons then live operational data ──── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], flexShrink: 0, flexWrap: 'nowrap' }}>

        {showAddRes && (
          <button onClick={onAddRes} style={{ ...ghostBase, color: canvas(0.90), border: `${rule.hairline} solid ${sep(0.40)}` }}>
            + RES
          </button>
        )}
        {showSummary  && <button onClick={onSummary}   style={ghostBase}>SUMMARY</button>}
        {showMenu     && <button onClick={onMenu}      style={ghostBase}>MENU</button>}
        {showInventory && <button onClick={onInventory} style={ghostBase}>INVENTORY</button>}
        {showSeed && (
          <button onClick={onSeed} style={{ ...ghostBase, color: tokens.green.text, border: `${rule.hairline} solid ${tokens.green.border}` }}>
            SEED TEST
          </button>
        )}
        {showArchive  && <button onClick={onArchive}   style={ghostBase}>ARCHIVE</button>}

        {showSync && (
          <button
            onClick={handleSyncAll}
            disabled={sSt === "syncing"}
            title={sMsg || undefined}
            style={{
              ...ghostBase,
              border: `${rule.hairline} solid ${
                sSt === 'ok'      ? tokens.green.border :
                sSt === 'partial' ? sep(0.40) :
                sSt === 'err'     ? tokens.red.border  :
                sep(0.22)
              }`,
              color:  sSt === 'ok'  ? tokens.green.text :
                      sSt === 'err' ? tokens.red.text   :
                      canvas(0.70),
              cursor: sSt === "syncing" ? "not-allowed" : "pointer",
            }}
          >
            {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "partial" ? "⚠ PARTIAL" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
          </button>
        )}

        {showSync && (sSt === "err" || sSt === "partial") && sMsg && (
          <span
            style={{ ...typeScale.label, fontFamily: font, color: sSt === "err" ? tokens.red.text : canvas(0.60), maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={sMsg}
          >
            {sMsg}
          </span>
        )}

        {/* Realtime indicator */}
        <span style={{
          ...typeScale.label,
          fontFamily: font,
          padding:    `${space[1]} ${space[2]}`,
          border:     `${rule.hairline} solid ${syncLive ? tokens.green.border : sep(0.22)}`,
          background: 'none',
          color:      syncLive ? tokens.green.text : canvas(0.40),
          whiteSpace: 'nowrap',
        }}>
          {syncLabel}
        </span>

        {showEndService && (
          <button onClick={onEndService} style={{ ...ghostBase, color: tokens.red.text, border: `${rule.hairline} solid ${tokens.red.border}` }}>
            END SERVICE
          </button>
        )}
        <button onClick={onExit} style={ghostBase}>EXIT</button>

        {/* Separator before live data */}
        {hasCoverData && (
          <span style={{ width: rule.hairline, height: '14px', background: sep(0.22), flexShrink: 0 }} />
        )}

        {/* COVERS_XX   TABLES_XX — gold, signal.active */}
        {hasCoverData && (
          <span style={{ ...typeScale.label, fontFamily: font, color: signal.active, whiteSpace: 'nowrap', letterSpacing: '0.10em' }}>
            {`COVERS_${String(seated ?? 0).padStart(2, '0')}   TABLES_${String(activeCount ?? 0).padStart(2, '0')}`}
          </span>
        )}

        {/* Alert dot — single signal.alert square, no text */}
        {hasAllergyFlag && (
          <span style={{
            display:         'inline-block',
            width:           '5px',
            height:          '5px',
            borderRadius:    0,
            backgroundColor: signal.alert,
            flexShrink:      0,
          }} />
        )}
      </div>
    </div>
  );
}
