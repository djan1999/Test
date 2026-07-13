import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import { supabase, setRememberMe, getRememberMe } from "../../lib/supabaseClient.js";
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
  const [remember, setRemember] = useState(() => getRememberMe());
  const [resetSent, setResetSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    if (!e || !pw) { setErr("Enter your email and password."); return; }
    setBusy(true);
    setErr("");
    // Apply the preference BEFORE signing in so the new session is written to the
    // right store (localStorage when remembered, sessionStorage when not).
    setRememberMe(remember);
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

  const requestPasswordReset = async () => {
    if (busy) return;
    const e = email.trim();
    if (!e) { setErr("Enter your email first."); return; }
    setBusy(true);
    setErr("");
    setResetSent(false);
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?set-password=1`;
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });
      if (error) throw error;
      setResetSent(true);
    } catch (ex) {
      setErr(ex?.message || "Could not send the reset email.");
    } finally {
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

      <form
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        style={{ width: "100%", maxWidth: 320, textAlign: "center", animation: shake ? "shake 0.4s ease" : "none" }}
      >
        <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: tokens.text.muted, marginBottom: 24, textTransform: "uppercase" }}>
          sign in
        </div>

        <input
          type="email"
          aria-label="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
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
            aria-label="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoComplete="current-password"
            placeholder="password"
            style={{
              ...baseInput, textAlign: "center",
              fontSize: tokens.mobileInputSize, paddingRight: 44,
              borderColor: err ? tokens.red.border : tokens.neutral[300],
              transition: "border-color 0.2s",
            }}
          />
          <button type="button" onClick={() => setShow(s => !s)} style={{
            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: tokens.neutral[400], fontSize: 13, padding: 0, lineHeight: 1,
          }}>{show ? "hide" : "show"}</button>
        </div>

        {err ? (
          <div role="alert" style={{ fontSize: 11, color: tokens.red.text, marginBottom: 12, lineHeight: 1.4 }}>{err}</div>
        ) : null}

        {resetSent ? (
          <div role="status" style={{ fontSize: 11, color: tokens.green.text, marginBottom: 12, lineHeight: 1.5 }}>
            Reset email sent. Open it on this device and choose a new password.
          </div>
        ) : null}

        <label style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 8, cursor: "pointer", userSelect: "none",
        }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            style={{ accentColor: tokens.charcoal.default, width: 15, height: 15, cursor: "pointer" }}
          />
          <span style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, color: tokens.text.secondary, textTransform: "uppercase" }}>
            Keep me signed in
          </span>
        </label>

        <button type="submit" disabled={busy} style={{
          width: "100%", fontFamily: FONT, fontSize: 11, letterSpacing: 3,
          padding: "14px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
          cursor: busy ? "not-allowed" : "pointer", background: tokens.surface.card,
          color: tokens.text.primary, textTransform: "uppercase", marginTop: 4,
          opacity: busy ? 0.6 : 1,
        }}>{busy ? "Signing in…" : "Sign in"}</button>
        <button
          type="button"
          onClick={requestPasswordReset}
          disabled={busy}
          style={{
            marginTop: 14, border: "none", background: "transparent", cursor: busy ? "not-allowed" : "pointer",
            color: tokens.text.secondary, fontFamily: FONT, fontSize: 10, letterSpacing: 1.5,
            textDecoration: "underline", textUnderlineOffset: 3,
          }}
        >
          Forgot password?
        </button>
      </form>

      <style>{`@keyframes shake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)} 40%{transform:translateX(8px)}
        60%{transform:translateX(-5px)} 80%{transform:translateX(5px)}
      }`}</style>
    </div>
  );
}
