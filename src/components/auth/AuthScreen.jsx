import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import { supabase } from "../../lib/supabaseClient.js";
import GlobalStyle from "../ui/GlobalStyle.jsx";

const FONT = tokens.font;
const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const APP_SUBTITLE = String(import.meta.env.VITE_APP_SUBTITLE || "SERVICE BOARD").trim() || "SERVICE BOARD";

// ── AuthScreen — email + password login (Supabase Auth) ───────────────────────
// On success the session is picked up by App's onAuthStateChange listener, which
// advances the app to the profile picker. We only surface errors here.
export default function AuthScreen() {
  const [email, setEmail]   = useState("");
  const [pw, setPw]         = useState("");
  const [show, setShow]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");
  const [shake, setShake]   = useState(false);

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    if (!e || !pw) { setErr("Enter your email and password."); return; }
    setBusy(true);
    setErr("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
      if (error) {
        setErr(error.message || "Could not sign in.");
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setBusy(false);
      }
      // On success, App re-renders via the auth listener — leave busy=true.
    } catch (ex) {
      setErr(ex?.message || "Could not sign in.");
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: tokens.surface.card,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: FONT, padding: "20px 16px",
    }}>
      <GlobalStyle />
      <div style={{ marginBottom: 52, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: 6, color: tokens.text.primary, marginBottom: 6 }}>{APP_NAME}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: tokens.text.secondary }}>{APP_SUBTITLE}</div>
      </div>

      <div style={{ width: "100%", maxWidth: 320, textAlign: "center", animation: shake ? "shake 0.4s ease" : "none" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: tokens.text.muted, marginBottom: 24, textTransform: "uppercase" }}>
          sign in
        </div>

        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          autoFocus
          autoComplete="email"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="email"
          style={{ ...baseInput, textAlign: "center", fontSize: tokens.mobileInputSize, marginBottom: 12 }}
        />

        <div style={{ position: "relative", marginBottom: 12 }}>
          <input
            type={show ? "text" : "password"}
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            autoComplete="current-password"
            placeholder="password"
            style={{
              ...baseInput, textAlign: "center",
              fontSize: tokens.mobileInputSize, paddingRight: 44,
              borderColor: err ? tokens.red.border : tokens.neutral[300],
              transition: "border-color 0.2s",
            }}
          />
          <button onClick={() => setShow(s => !s)} style={{
            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: tokens.neutral[400], fontSize: 13, padding: 0, lineHeight: 1,
          }}>{show ? "hide" : "show"}</button>
        </div>

        {err ? (
          <div style={{ fontSize: 11, color: tokens.red.text, marginBottom: 12, lineHeight: 1.4 }}>{err}</div>
        ) : null}

        <button onClick={submit} disabled={busy} style={{
          width: "100%", fontFamily: FONT, fontSize: 11, letterSpacing: 3,
          padding: "14px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
          cursor: busy ? "not-allowed" : "pointer", background: tokens.surface.card,
          color: tokens.text.primary, textTransform: "uppercase", marginTop: 4,
          opacity: busy ? 0.6 : 1,
        }}>{busy ? "Signing in…" : "Sign in"}</button>
      </div>

      <style>{`@keyframes shake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)} 40%{transform:translateX(8px)}
        60%{transform:translateX(-5px)} 80%{transform:translateX(5px)}
      }`}</style>
    </div>
  );
}
