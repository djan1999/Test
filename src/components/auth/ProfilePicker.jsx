import { tokens } from "../../styles/tokens.js";
import GlobalStyle from "../ui/GlobalStyle.jsx";

const FONT = tokens.font;
const { ink, rule, neutral } = tokens;

const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const MANAGED_ONBOARDING_ENABLED = import.meta.env.VITE_ENABLE_MANAGED_ONBOARDING === "true";

const KIND_LABEL = {
  restaurant: "restaurant",
  sandbox: "test · sandbox",
};

// ── ProfilePicker — choose which restaurant (workspace) to work in ────────────
// A normal restaurant or Demo login sees only its explicit membership and App
// auto-selects it. This generic picker remains for an account deliberately
// linked to more than one workspace later.
export default function ProfilePicker({
  workspaces = [],
  onPick,
  onSignOut,
  managedOnboardingEnabled = MANAGED_ONBOARDING_ENABLED,
}) {
  return (
    <div style={{
      minHeight: "100vh", background: ink.bg,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <GlobalStyle />

      <div style={{ marginBottom: 44, textAlign: "center" }}>
        <div style={{
          fontFamily: FONT, fontSize: "16px", fontWeight: 700, letterSpacing: "0.32em",
          color: ink[0], marginBottom: 10, textTransform: "uppercase",
        }}>{APP_NAME}</div>
        <div style={{
          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.22em",
          textTransform: "uppercase", color: ink[3],
        }}>choose a restaurant</div>
      </div>

      {workspaces.length === 0 ? (
        <div style={{ fontFamily: FONT, fontSize: 11, color: ink[3], textAlign: "center", maxWidth: 280, lineHeight: 1.6 }}>
          This account isn’t linked to any restaurant yet.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 520 }}>
          {workspaces.map(w => (
            <button key={w.id} onClick={() => onPick?.(w.id)} style={{
              fontFamily: FONT, cursor: "pointer", background: neutral[0],
              border: `${rule.hairline} solid ${w.kind === "sandbox" ? ink[2] : ink[4]}`,
              borderRadius: 0, WebkitAppearance: "none", appearance: "none",
              padding: "20px 24px", width: 168, textAlign: "left",
              display: "flex", flexDirection: "column", gap: 10, touchAction: "manipulation",
            }}>
              <div style={{
                fontFamily: FONT, fontSize: "12px", letterSpacing: "0.06em",
                color: ink[0], fontWeight: 600, lineHeight: 1.2,
              }}>{w.name}</div>
              <div style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em",
                color: w.kind === "sandbox" ? ink[1] : ink[3], lineHeight: 1.4, textTransform: "uppercase",
              }}>{KIND_LABEL[w.kind] || w.kind}</div>
            </button>
          ))}
        </div>
      )}

      {managedOnboardingEnabled ? (
        <a href="/platform-onboarding" style={{
          marginTop: 24, fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
          textTransform: "uppercase", color: ink[0], background: neutral[0],
          border: `${rule.hairline} solid ${ink[2]}`, padding: "12px 18px",
          textDecoration: "none",
        }}>
          {workspaces.length ? "create another restaurant" : "create your restaurant"}
        </a>
      ) : null}

      {onSignOut ? (
        <button onClick={onSignOut} style={{
          marginTop: 36, fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
          textTransform: "uppercase", color: ink[3], background: "none", border: "none",
          cursor: "pointer", padding: 8,
        }}>sign out</button>
      ) : null}
    </div>
  );
}
