import { useState } from "react";
import { downloadPrivacyExport, requestPrivacyAction } from "../../lib/privacy.js";
import { clearGuestDataCaches } from "../../utils/storage.js";
import { tokens } from "../../styles/tokens.js";
import { baseInp, dangerBtn, primaryBtn, sectionHeader } from "./adminStyles.js";

const totalMatches = (counts = {}) => Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

export default function DataPrivacyPanel({
  accessToken,
  workspaceId,
  appName = "Restaurant",
  onErasureComplete = null,
}) {
  const [busy, setBusy] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(null);

  const exportWorkspace = async () => {
    if (busy) return;
    setBusy("export");
    setMessage(null);
    try {
      await downloadPrivacyExport({ accessToken, workspaceId });
      setMessage({ type: "success", text: "Workspace export downloaded. Store it only in an approved secure location." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(null);
    }
  };

  const previewErasure = async () => {
    const exactName = guestName.trim().replace(/\s+/g, " ");
    if (!exactName || busy) return;
    setBusy("preview");
    setPreview(null);
    setMessage(null);
    try {
      const data = await requestPrivacyAction({
        accessToken,
        workspaceId,
        action: "preview-erasure",
        payload: { guestName: exactName },
      });
      setPreview({ guestName: exactName, counts: data.counts || {} });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(null);
    }
  };

  const eraseGuest = async () => {
    if (!preview || totalMatches(preview.counts) === 0 || busy) return;
    const typed = window.prompt(
      `This removes matching reservations and redacts this guest from service history.\n\nType the exact guest name to continue:\n${preview.guestName}`,
    );
    if (typed !== preview.guestName) return;
    if (!window.confirm(
      "Final confirmation: erase this guest's matched data? This cannot be undone except from a prior protected backup.",
    )) return;
    setBusy("erase");
    setMessage(null);
    try {
      const data = await requestPrivacyAction({
        accessToken,
        workspaceId,
        action: "erase-guest",
        payload: { guestName: preview.guestName, confirmation: typed },
      });
      clearGuestDataCaches();
      const localReset = await onErasureComplete?.();
      setGuestName("");
      setPreview(null);
      setMessage({
        type: "success",
        text: localReset?.ok === false
          ? `Erasure completed (${totalMatches(data.counts)} matched records), but this tablet could not reset its local sync database. Server replay protection remains active; reset this tablet from Admin → System before continuing.`
          : localReset?.syncReset
            ? `Erasure completed (${totalMatches(data.counts)} matched records). This tablet's pending writes were discarded and its local sync database was rebuilt; server replay protection blocks stale copies from other tablets.`
            : `Erasure completed (${totalMatches(data.counts)} matched records). This tablet's pending fallback writes and cached guest data were cleared; server replay protection blocks stale copies from other tablets.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div style={sectionHeader}>Data & Privacy</div>
      <p style={{ fontSize: 11, color: tokens.ink[2], lineHeight: 1.6, maxWidth: 720, margin: "0 0 18px" }}>
        {appName} stores names, service notes, room references, and dietary restrictions. Exports and erasures are
        Admin-only and apply only to this restaurant. Record the controller's approved request before using either action.
      </p>

      <div style={{ border: `1px solid ${tokens.ink[4]}`, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.ink[0], marginBottom: 7 }}>Workspace export</div>
        <p style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.55, margin: "0 0 12px", maxWidth: 680 }}>
          Downloads a JSON copy of workspace configuration, catalogues, reservations, service history, memberships, and audit records.
          The file can contain health-related guest data; protect it accordingly.
        </p>
        <button type="button" disabled={Boolean(busy)} onClick={exportWorkspace} style={{ ...primaryBtn, opacity: busy ? 0.55 : 1 }}>
          {busy === "export" ? "PREPARING..." : "DOWNLOAD WORKSPACE EXPORT"}
        </button>
      </div>

      <div style={{ border: `1px solid ${tokens.red.border}`, padding: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.red.text, marginBottom: 7 }}>Erase one guest</div>
        <p style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.55, margin: "0 0 12px", maxWidth: 680 }}>
          Exact-name matching deletes current reservation rows and redacts party-linked fields in live and historical service rows.
          It preserves anonymous timing/cover/order history. Preview first; similarly named guests are not merged automatically.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6, flex: "1 1 260px", fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: tokens.ink[3] }}>
            Exact reservation name
            <input
              value={guestName}
              onChange={(event) => { setGuestName(event.target.value); setPreview(null); }}
              placeholder="Guest name as entered"
              autoComplete="off"
              style={{ ...baseInp, fontSize: tokens.mobileInputSize }}
            />
          </label>
          <button type="button" disabled={!guestName.trim() || Boolean(busy)} onClick={previewErasure} style={{ ...primaryBtn, opacity: !guestName.trim() || busy ? 0.55 : 1 }}>
            {busy === "preview" ? "CHECKING..." : "PREVIEW MATCHES"}
          </button>
        </div>

        {preview && (
          <div style={{ marginTop: 14, padding: 12, background: tokens.ink.bg, border: `1px solid ${tokens.ink[4]}` }}>
            <div style={{ fontSize: 10, color: tokens.ink[1], lineHeight: 1.6 }}>
              Reservations: {preview.counts.reservations || 0} · Service rows: {preview.counts.serviceTables || 0} ·
              Legacy archives: {preview.counts.legacyArchives || 0} · Audit rows: {preview.counts.auditRows || 0}
            </div>
            <button
              type="button"
              disabled={totalMatches(preview.counts) === 0 || Boolean(busy)}
              onClick={eraseGuest}
              style={{ ...dangerBtn, marginTop: 10, opacity: totalMatches(preview.counts) === 0 || busy ? 0.55 : 1 }}
            >
              {busy === "erase" ? "ERASING..." : "ERASE MATCHED GUEST DATA"}
            </button>
          </div>
        )}
      </div>

      {message && (
        <div role={message.type === "error" ? "alert" : "status"} style={{
          marginTop: 14, padding: "10px 12px", fontSize: 10, lineHeight: 1.5,
          color: message.type === "error" ? tokens.red.text : tokens.green.text,
          background: message.type === "error" ? tokens.red.bg : tokens.green.bg,
          border: `1px solid ${message.type === "error" ? tokens.red.border : tokens.green.border}`,
        }}>
          {message.text}
        </div>
      )}
    </section>
  );
}
