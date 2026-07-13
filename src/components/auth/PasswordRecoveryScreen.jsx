import { useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import GlobalStyle from "../ui/GlobalStyle.jsx";

const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";

export default function PasswordRecoveryScreen({ onComplete, appName = APP_NAME }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onComplete?.();
    } catch (updateError) {
      setError(updateError?.message || "Could not save the new password.");
      setBusy(false);
    }
  };

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: tokens.surface.card, padding: 20, fontFamily: tokens.font,
    }}>
      <GlobalStyle />
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 5, marginBottom: 34 }}>{appName}</div>
        <h1 style={{ fontSize: 12, letterSpacing: 2.5, textTransform: "uppercase", margin: "0 0 10px" }}>
          Choose a new password
        </h1>
        <p style={{ fontSize: 11, color: tokens.text.secondary, lineHeight: 1.5, margin: "0 0 22px" }}>
          This password belongs only to your staff account. Use at least 10 characters.
        </p>
        <input
          aria-label="New password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="new password"
          style={{ ...baseInput, width: "100%", boxSizing: "border-box", textAlign: "center", fontSize: tokens.mobileInputSize, marginBottom: 10 }}
        />
        <input
          aria-label="Confirm new password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="repeat password"
          style={{ ...baseInput, width: "100%", boxSizing: "border-box", textAlign: "center", fontSize: tokens.mobileInputSize, marginBottom: 10 }}
        />
        <label style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, fontSize: 10, color: tokens.text.secondary, marginBottom: 14 }}>
          <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />
          Show password
        </label>
        {error ? <div role="alert" style={{ color: tokens.red.text, fontSize: 11, marginBottom: 12 }}>{error}</div> : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%", padding: 14, border: `1px solid ${tokens.charcoal.default}`,
            background: tokens.surface.card, color: tokens.text.primary, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: tokens.font, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving..." : "Save password"}
        </button>
      </form>
    </main>
  );
}
