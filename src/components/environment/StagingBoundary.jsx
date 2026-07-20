import { deploymentIsolation } from "../../config/deploymentEnvironment.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

export default function StagingBoundary({ children }) {
  if (!deploymentIsolation.safe) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: tokens.ink.bg, fontFamily: FONT }}>
        <section style={{ width: "100%", maxWidth: 680, border: `2px solid ${tokens.signal.alert}`, background: tokens.neutral[0], padding: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.signal.alert, marginBottom: 12 }}>
            [STAGING BLOCKED]
          </div>
          <h1 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 500, color: tokens.ink[0] }}>
            This test build is not isolated.
          </h1>
          <p style={{ margin: "0 0 16px", fontSize: 12, lineHeight: 1.7, color: tokens.ink[2] }}>
            The application has stopped before login or synchronization so it cannot touch restaurant production data.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11, lineHeight: 1.8, color: tokens.signal.alert }}>
            {deploymentIsolation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>
      </main>
    );
  }

  return (
    <>
      {children}
      {deploymentIsolation.isStaging && (
        <div aria-label="Staging environment" style={{
          position: "fixed", right: 10, bottom: 10, zIndex: 10000,
          border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0],
          color: tokens.ink[1], padding: "7px 9px", fontFamily: FONT,
          fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
          pointerEvents: "none",
        }}>
          [RESERVATIONS LAB · TEST DATA]
        </div>
      )}
    </>
  );
}

