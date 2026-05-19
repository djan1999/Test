import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import GlobalStyle from "../ui/GlobalStyle.jsx";

const FONT = tokens.font;
const { ink, rule, neutral, green, red, charcoal } = tokens;

const APP_NAME     = String(import.meta.env.VITE_APP_NAME     || "MILKA").trim()         || "MILKA";
const APP_SUBTITLE = String(import.meta.env.VITE_APP_SUBTITLE || "SERVICE BOARD").trim() || "SERVICE BOARD";
const PINS = {
  admin: String(import.meta.env.VITE_PIN_ADMIN || "").trim(),
  menu:  String(import.meta.env.VITE_PIN_MENU  || "").trim(),
};

export default function LoginScreen({ onEnter, onSyncAll }) {
  const MODES = [
    { id: "display",     label: "Kitchen",      sub: "fire courses · KDS",  pin: false },
    { id: "service",     label: "Service",      sub: "full service access", pin: false },
    { id: "reservation", label: "Reservations", sub: "weekly planner",      pin: false },
    { id: "admin",       label: "Admin",        sub: "pin required",        pin: true  },
    { id: "menu",        label: "Menu",         sub: "preview + print",     pin: true  },
  ];

  const [picking, setPicking] = useState(null);
  const [pin, setPin]         = useState("");
  const [shake, setShake]     = useState(false);
  const [syncSt, setSyncSt]   = useState(null);

  const handleSync = async () => {
    if (!onSyncAll || syncSt === "syncing") return;
    setSyncSt("syncing");
    try {
      const r = await onSyncAll();
      console.log("[LoginSync]", r);
      setSyncSt(r?.ok ? "ok" : "err");
    } catch (e) {
      console.error("[LoginSync] threw:", e);
      setSyncSt("err");
    }
    setTimeout(() => setSyncSt(null), 3000);
  };

  const handleTile = mode => {
    if (!mode.pin) { onEnter(mode.id); return; }
    if (!PINS[mode.id]) { onEnter(mode.id); return; }
    setPicking(mode.id);
    setPin("");
  };

  const handleDigit = d => {
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === PINS[picking]) {
        onEnter(picking);
        setPicking(null);
      } else {
        setShake(true);
        setPin("");
        setTimeout(() => setShake(false), 500);
      }
    }
  };

  useEffect(() => {
    if (!picking) return;
    const onKey = e => {
      if (e.key >= "0" && e.key <= "9") handleDigit(e.key);
      else if (e.key === "Backspace") setPin(p => p.slice(0, -1));
      else if (e.key === "Escape") { setPicking(null); setPin(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mode tile style ────────────────────────────────────────
  const tileSt = {
    fontFamily:  FONT,
    cursor:      "pointer",
    background:  neutral[0],
    border:      `${rule.hairline} solid ${ink[4]}`,
    borderRadius: 0,
    WebkitAppearance: "none",
    appearance: "none",
    padding:     "20px 24px",
    width:       148,
    textAlign:   "left",
    display:     "flex",
    flexDirection: "column",
    gap:         10,
    touchAction: "manipulation",
  };

  // Sync button style
  const syncBorder = syncSt === "ok" ? green.border : syncSt === "err" ? red.border : ink[4];
  const syncBg     = syncSt === "ok" ? green.bg     : syncSt === "err" ? red.bg     : neutral[50];
  const syncColor  = syncSt === "ok" ? green.text   : syncSt === "err" ? red.text   : ink[3];
  const syncText   = syncSt === "syncing" ? "SYNCING…" : syncSt === "ok" ? "✓ SYNCED" : syncSt === "err" ? "✗ FAILED" : "[↻] SYNC WINES";

  return (
    <div style={{
      minHeight:      "100vh",
      background:     ink.bg,
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      padding:        24,
    }}>
      <GlobalStyle />

      {/* App name + subtitle */}
      <div style={{ marginBottom: 52, textAlign: "center" }}>
        <div style={{
          fontFamily:    FONT,
          fontSize:      "16px",
          fontWeight:    700,
          letterSpacing: "0.32em",
          color:         ink[0],
          marginBottom:  10,
          textTransform: "uppercase",
        }}>{APP_NAME}</div>
        <div style={{
          fontFamily:    FONT,
          fontSize:      "8px",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color:         ink[3],
        }}>{APP_SUBTITLE}</div>
      </div>

      {!picking ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>

          {/* Mode tiles */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 500 }}>
            {MODES.map(m => (
              <button key={m.id} onClick={() => handleTile(m)} style={tileSt}>
                <div style={{
                  fontFamily:    FONT,
                  fontSize:      "11px",
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  color:         ink[0],
                  fontWeight:    600,
                  lineHeight:    1,
                }}>[{m.label}]</div>
                <div style={{
                  fontFamily:    FONT,
                  fontSize:      "8px",
                  letterSpacing: "0.06em",
                  color:         ink[3],
                  lineHeight:    1.4,
                }}>{m.sub}</div>
              </button>
            ))}
          </div>

          {/* Sync button */}
          {onSyncAll && (
            <button
              onClick={handleSync}
              disabled={syncSt === "syncing"}
              style={{
                fontFamily:    FONT,
                fontSize:      "9px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                padding:       "7px 18px",
                borderRadius:  0,
                cursor:        syncSt === "syncing" ? "not-allowed" : "pointer",
                border:        `${rule.hairline} solid ${syncBorder}`,
                background:    syncBg,
                color:         syncColor,
                fontWeight:    400,
              }}
            >{syncText}</button>
          )}
        </div>

      ) : (
        // ── PIN entry ───────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, width: "100%", maxWidth: 280 }}>
          <div style={{
            fontFamily:    FONT,
            fontSize:      "9px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color:         ink[3],
          }}>ENTER PIN</div>

          {/* Dot indicators */}
          <div style={{ display: "flex", gap: 14, animation: shake ? "shake 0.4s" : "none" }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width:      12,
                height:     12,
                borderRadius: 0,
                border:     `${rule.hairline} solid ${i < pin.length ? ink[0] : ink[4]}`,
                background: i < pin.length ? ink[0] : "transparent",
                transition: "background 0.1s, border-color 0.1s",
              }} />
            ))}
          </div>

          {/* Numpad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, width: "100%" }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
              <button
                key={i}
                onClick={() => {
                  if (d === "⌫") setPin(p => p.slice(0, -1));
                  else if (d !== "") handleDigit(d);
                }}
                disabled={d === ""}
                aria-label={d === "⌫" ? "Backspace" : d === "" ? undefined : `Digit ${d}`}
                aria-hidden={d === "" ? true : undefined}
                style={{
                  fontFamily:  FONT,
                  fontSize:    "20px",
                  fontWeight:  300,
                  padding:     "16px 0",
                  border:      `${rule.hairline} solid ${d === "" ? "transparent" : ink[4]}`,
                  borderRadius: 0,
                  background:  d === "" ? "transparent" : neutral[0],
                  cursor:      d === "" ? "default" : "pointer",
                  color:       ink[0],
                  opacity:     d === "" ? 0 : 1,
                  transition:  "all 0.08s",
                  minHeight:   52,
                  touchAction: "manipulation",
                }}
              >{d}</button>
            ))}
          </div>

          <button
            onClick={() => { setPicking(null); setPin(""); }}
            style={{
              fontFamily:    FONT,
              fontSize:      "9px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color:         ink[3],
              background:    "none",
              border:        "none",
              cursor:        "pointer",
              padding:       8,
            }}
          >CANCEL</button>

          <style>{`@keyframes shake {
            0%{transform:translateX(0)} 20%{transform:translateX(-8px)}
            40%{transform:translateX(8px)} 60%{transform:translateX(-5px)}
            80%{transform:translateX(5px)} 100%{transform:translateX(0)}
          }`}</style>
        </div>
      )}
    </div>
  );
}
