import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const APP_SUBTITLE = String(import.meta.env.VITE_APP_SUBTITLE || "SERVICE BOARD").trim() || "SERVICE BOARD";
const PINS = {
  admin: String(import.meta.env.VITE_PIN_ADMIN || "").trim(),
  menu: String(import.meta.env.VITE_PIN_MENU || "").trim(),
};

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: #1a1a1a; }
      input, textarea, select { font-size: ${tokens.mobileInputSize}px; }
      button, a, label { touch-action: manipulation; }
    `}</style>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
export default function LoginScreen({ onEnter, onSyncAll }) {
  const MODES = [
    { id: "display",     label: "Display",      sub: "read-only view",      icon: "◎", pin: false },
    { id: "service",     label: "Service",      sub: "full service access",  icon: "◈", pin: false },
    { id: "reservation", label: "Reservations", sub: "weekly planner",       icon: "◫", pin: false },
    { id: "admin",       label: "Admin",        sub: "pin required",         icon: "◆", pin: true  },
    { id: "menu",        label: "Menu",         sub: "preview + print",      icon: "▨", pin: true  },
  ];
  const [picking, setPicking] = useState(null);
  const [pin, setPin]         = useState("");
  const [shake, setShake]     = useState(false);
  const [syncSt, setSyncSt]   = useState(null); // null | "syncing" | "ok" | "err"

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

  return (
    <div style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <GlobalStyle />
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, letterSpacing: 6, color: "#1a1a1a", marginBottom: 8 }}>{APP_NAME}</div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#999" }}>{APP_SUBTITLE}</div>
      </div>

      {!picking ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
            {MODES.map(m => (
              <button key={m.id} onClick={() => handleTile(m)} style={{
                fontFamily: FONT, cursor: "pointer",
                background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
                padding: "28px 32px", width: 140, textAlign: "center",
                transition: "all 0.12s", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 24, color: "#444" }}>{m.icon}</span>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#1a1a1a", fontWeight: 500 }}>{m.label.toUpperCase()}</div>
                  <div style={{ fontSize: 9, letterSpacing: 1, color: "#999", marginTop: 4 }}>{m.sub}</div>
                </div>
              </button>
            ))}
          </div>
          {onSyncAll && (
            <button onClick={handleSync} disabled={syncSt === "syncing"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2,
              padding: "6px 16px", borderRadius: tokens.radius, cursor: syncSt === "syncing" ? "not-allowed" : "pointer",
              border: `1px solid ${syncSt === "ok" ? "#8fc39f" : syncSt === "err" ? "#e89898" : "#ddd"}`,
              background: syncSt === "ok" ? "#eef8f1" : syncSt === "err" ? "#fff0f0" : "#fafafa",
              color: syncSt === "ok" ? "#2f7a45" : syncSt === "err" ? "#c04040" : "#aaa",
            }}>
              {syncSt === "syncing" ? "SYNCING…" : syncSt === "ok" ? "✓ SYNCED" : syncSt === "err" ? "✗ FAILED" : "↻ SYNC WINES"}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, width: "100%", maxWidth: 320 }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#666" }}>ENTER PIN</div>
          <div style={{
            display: "flex", gap: 14, animation: shake ? "shake 0.4s" : "none",
          }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: 14, height: 14, borderRadius: tokens.radius,
                border: `1px solid ${i < pin.length ? "#1a1a1a" : "#e0e0e0"}`,
                background: i < pin.length ? "#fff" : "#fafafa",
                transition: "background 0.1s, border-color 0.1s",
              }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: "100%" }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
              <button key={i} onClick={() => {
                if (d === "⌫") setPin(p => p.slice(0,-1));
                else if (d !== "") handleDigit(d);
              }} disabled={d === ""} style={{
                fontFamily: FONT, fontSize: 22, fontWeight: 300,
                padding: "18px 0", border: "1px solid #e8e8e8", borderRadius: 2,
                background: d === "" ? "transparent" : "#fff", cursor: d === "" ? "default" : "pointer",
                color: "#1a1a1a", letterSpacing: 1,
                opacity: d === "" ? 0 : 1,
                transition: "all 0.08s",
              }}>{d}</button>
            ))}
          </div>
          <button onClick={() => { setPicking(null); setPin(""); }} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 2, color: "#999",
            background: "none", border: "none", cursor: "pointer", padding: 8,
          }}>CANCEL</button>
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
