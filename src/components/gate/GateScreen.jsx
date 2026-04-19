import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";

const FONT = tokens.font;
const R = tokens.radius.sm;
const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const APP_SUBTITLE = String(import.meta.env.VITE_APP_SUBTITLE || "SERVICE BOARD").trim() || "SERVICE BOARD";
const ACCESS_PASSWORD = String(import.meta.env.VITE_ACCESS_PASSWORD || "").trim();
const ACCESS_KEY = "milka_access";

const writeAccess = () => {
  try { localStorage.setItem(ACCESS_KEY, JSON.stringify({ ts: Date.now() })); } catch {}
};

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: ${tokens.colors.ink}; }
      input, textarea, select { font-size: ${tokens.mobileInputSize}px; }
      button, a, label { touch-action: manipulation; }
    `}</style>
  );
}

// ── GateScreen — password wall before anything else ───────────────────────────
export default function GateScreen({ onPass }) {
  const [pw, setPw]       = useState("");
  const [shake, setShake] = useState(false);
  const [show, setShow]   = useState(false);

  const attempt = val => {
    if (!ACCESS_PASSWORD) {
      writeAccess();
      onPass();
      return;
    }
    if (val === ACCESS_PASSWORD) {
      writeAccess();
      onPass();
    } else {
      setShake(true);
      setTimeout(() => { setShake(false); setPw(""); }, 600);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "transparent",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: FONT, padding: "20px 16px",
    }}>
      <GlobalStyle />
      <div style={{ marginBottom: 52, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: 6, color: tokens.colors.ink, marginBottom: 6 }}>{APP_NAME}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: tokens.colors.gray700 }}>{APP_SUBTITLE}</div>
      </div>

      <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: tokens.colors.gray500, marginBottom: 28, textTransform: "uppercase" }}>
          enter password
        </div>

        <div style={{ animation: shake ? "shake 0.4s ease" : "none", marginBottom: 12 }}>
          <div style={{ position: "relative" }}>
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && attempt(pw)}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{
                ...baseInput,
                textAlign: "center",
                letterSpacing: show ? 2 : 6,
                fontSize: tokens.mobileInputSize,
                paddingRight: 44,
                borderColor: shake ? tokens.colors.redBorder : undefined,
                transition: "border-color 0.2s",
              }}
              placeholder="••••••••"
            />
            <button onClick={() => setShow(s => !s)} style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              color: tokens.colors.gray400, fontSize: 13, padding: 0, lineHeight: 1,
            }}>{show ? "hide" : "show"}</button>
          </div>
        </div>

        <button onClick={() => attempt(pw)} style={{
          width: "100%", fontFamily: FONT, fontSize: 11, letterSpacing: 3,
          padding: "14px", border: `1px solid ${tokens.colors.goldHover}`, borderRadius: R,
          cursor: "pointer",
          background: `linear-gradient(180deg, ${tokens.colors.gold} 0%, ${tokens.colors.goldHover} 100%)`,
          color: tokens.colors.white,
          textTransform: "uppercase", marginTop: 8,
          boxShadow: tokens.shadow.sm,
        }}>Enter</button>
      </div>

      <style>{`@keyframes shake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)} 40%{transform:translateX(8px)}
        60%{transform:translateX(-5px)} 80%{transform:translateX(5px)}
      }`}</style>
    </div>
  );
}
