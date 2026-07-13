import { useCallback, useEffect, useState } from "react";
import { fetchAuditLog } from "../../lib/auditStore.js";
import { tokens } from "../../styles/tokens.js";
import { primaryBtn, sectionHeader } from "./adminStyles.js";

const ENTITY_LABELS = {
  workspace_members: "staff member",
  menu_courses: "menu course",
  wines: "wine",
  beverages: "drink",
  service_settings: "restaurant setting",
};

function describeEntry(entry) {
  const verb = entry.action === "insert" ? "created" : entry.action === "delete" ? "deleted" : "changed";
  const entity = ENTITY_LABELS[entry.entity_type] || entry.entity_type;
  const key = entry.entity_key ? ` (${entry.entity_key})` : "";
  return `${verb} ${entity}${key}`;
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEntries(await fetchAuditLog(200));
    } catch (queryError) {
      setError(queryError?.message || "Could not load the audit trail.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <div style={{ ...sectionHeader, marginBottom: 0 }}>Admin Audit Trail</div>
        <button type="button" onClick={load} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.55 : 1 }}>
          REFRESH
        </button>
      </div>
      <p style={{ fontSize: 11, color: tokens.ink[2], lineHeight: 1.55, maxWidth: 680, margin: "0 0 18px" }}>
        This records human changes to staff roles, restaurant setup, menus, wines and drinks. Live service taps are intentionally excluded so important admin changes are not buried in noise.
      </p>
      {error ? <div role="alert" style={{ color: tokens.red.text, fontSize: 10, marginBottom: 14 }}>{error}</div> : null}
      {loading ? <div style={{ fontSize: 10, color: tokens.ink[3] }}>Loading changes...</div> : null}
      {!loading && !error && entries.length === 0 ? (
        <div style={{ fontSize: 10, color: tokens.ink[3] }}>No administrative changes have been recorded yet.</div>
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {entries.map((entry) => (
          <article key={entry.id} style={{ border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 10, color: tokens.ink[0], fontWeight: 600 }}>{describeEntry(entry)}</strong>
              <time dateTime={entry.created_at} style={{ fontSize: 9, color: tokens.ink[3] }}>
                {new Date(entry.created_at).toLocaleString()}
              </time>
            </div>
            <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 5, overflowWrap: "anywhere" }}>
              By {entry.actor_email || entry.actor_id || "system"}
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 9, color: tokens.ink[2] }}>Technical details</summary>
              <pre style={{
                whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 9, lineHeight: 1.45,
                color: tokens.ink[2], background: tokens.ink.bg, padding: 10, overflowX: "auto",
              }}>
                {JSON.stringify({ before: entry.before_data, after: entry.after_data }, null, 2)}
              </pre>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
