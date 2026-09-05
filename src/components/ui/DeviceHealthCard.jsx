import { tokens } from "../../styles/tokens.js";
import { evaluateDeviceHealth, supportSummary, HEALTH } from "../../lib/deviceHealth.js";

const FONT = tokens.font;

// ── DeviceHealthCard — what to say when the restaurant phones ───────────────
// Rendered in two places on purpose: the admin SYSTEM panel, and behind the
// status chip on the service and kitchen screens. The kitchen one matters
// most — at 20:05 the person holding the problem is standing at the pass, and
// the Kitchen role cannot open Admin at all.

const TONE = {
  [HEALTH.HEALTHY]:    { bg: tokens.green.bg,   border: tokens.green.border, text: tokens.green.text },
  [HEALTH.IDLE]:       { bg: tokens.green.bg,   border: tokens.green.border, text: tokens.green.text },
  [HEALTH.CONNECTING]: { bg: tokens.neutral[0], border: tokens.ink[4],       text: tokens.ink[2] },
  [HEALTH.OFFLINE]:    { bg: tokens.neutral[0], border: tokens.signal.warn,  text: tokens.signal.warn },
  [HEALTH.STALLED]:    { bg: tokens.red.bg,     border: tokens.red.border,   text: tokens.red.text },
  [HEALTH.BLOCKED]:    { bg: tokens.red.bg,     border: tokens.red.border,   text: tokens.red.text },
  [HEALTH.UNKNOWN]:    { bg: tokens.neutral[0], border: tokens.ink[4],       text: tokens.ink[3] },
};

export default function DeviceHealthCard({
  online = typeof navigator === "undefined" ? true : navigator.onLine !== false,
  powerSyncStatus = null,
  syncStatus = null,
  serviceActive = true,
  diagnostics = [],
  buildId = "dev",
  role = "",
  workspaceSlug = "",
  compact = false,
}) {
  const health = evaluateDeviceHealth({ online, powerSyncStatus, syncStatus, serviceActive, diagnostics });
  const tone = TONE[health.state] || TONE[HEALTH.UNKNOWN];
  const summary = supportSummary({ health, buildId, role, workspaceSlug });

  return (
    <section
      aria-label="Device health"
      style={{
        border: `1px solid ${tone.border}`, background: tone.bg,
        padding: compact ? "14px 16px" : "18px 20px", fontFamily: FONT,
        display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div>
        <div style={{
          fontSize: 8, letterSpacing: 2, textTransform: "uppercase",
          color: tone.text, marginBottom: 8, opacity: 0.8,
        }}>Device health</div>
        <div role="status" style={{
          fontSize: compact ? 13 : 15, fontWeight: 700, letterSpacing: 0.5,
          color: tone.text, lineHeight: 1.3,
        }}>{health.headline}</div>
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.65, color: tokens.ink[1] }}>
        {health.meaning}
      </div>

      {/* The single next action, set apart so it survives being read aloud. */}
      <div style={{
        fontSize: 11, lineHeight: 1.65, color: tokens.ink[0], fontWeight: 600,
        borderTop: `1px solid ${tone.border}`, paddingTop: 12,
      }}>
        {health.action}
      </div>

      {health.escalate && (
        <div style={{ fontSize: 10, lineHeight: 1.6, color: tokens.ink[2] }}>
          If a second device shows the same thing, stop and call the platform operator — that
          pattern is a service fault, not a device fault.
        </div>
      )}

      {/* The facts behind the verdict. Whoever is on the phone reads these out
          instead of describing what the screen "looks like". */}
      <dl style={{
        margin: 0, display: "grid", gridTemplateColumns: "auto 1fr",
        gap: "4px 14px", fontSize: 10, color: tokens.ink[2],
      }}>
        {health.facts.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ letterSpacing: 1, textTransform: "uppercase", color: tokens.ink[3] }}>{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>

      <div style={{
        fontSize: 9, letterSpacing: 0.6, color: tokens.ink[3],
        borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 10, wordBreak: "break-all",
      }}>
        {summary}
      </div>
    </section>
  );
}
