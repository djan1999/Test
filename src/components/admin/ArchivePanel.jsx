import { useState, useEffect } from "react";
import { FONT } from "./adminStyles.js";
import { supabase, TABLES } from "../../lib/supabaseClient.js";

// ── ArchivePanel — view, restore, delete saved service archives ──
export default function ArchivePanel() {
  const [entries, setEntries]         = useState([]);
  const [deleted, setDeleted]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [showTrash, setShowTrash]     = useState(false);

  const loadEntries = () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      supabase.from(TABLES.SERVICE_ARCHIVE).select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
      supabase.from(TABLES.SERVICE_ARCHIVE).select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    ]).then(([active, trash]) => {
      setEntries(active.error ? [] : (active.data || []));
      setDeleted(trash.error ? [] : (trash.data || []));
      setLoading(false);
    });
  };
  useEffect(loadEntries, []);

  const deleteEntry = async id => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      window.alert("Delete failed: " + error.message);
    } else {
      const entry = entries.find(x => x.id === id);
      setEntries(e => e.filter(x => x.id !== id));
      if (entry) setDeleted(d => [{ ...entry, deleted_at: new Date().toISOString() }, ...d]);
      if (expanded === id) setExpanded(null);
    }
    setDeleting(null);
  };

  const deleteAll = async () => {
    if (!supabase) return;
    if (!window.confirm("Move ALL archive entries to trash?")) return;
    setDeleting("all");
    const now = new Date().toISOString();
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: now }).is("deleted_at", null);
    if (error) {
      window.alert("Delete failed: " + error.message);
    } else {
      setDeleted(d => [...entries.map(e => ({ ...e, deleted_at: now })), ...d]);
      setEntries([]);
      setExpanded(null);
    }
    setDeleting(null);
  };

  const restoreEntry = async id => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: null }).eq("id", id);
    if (error) {
      window.alert("Restore failed: " + error.message);
    } else {
      const entry = deleted.find(x => x.id === id);
      setDeleted(d => d.filter(x => x.id !== id));
      if (entry) setEntries(e => [{ ...entry, deleted_at: null }, ...e].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    setDeleting(null);
  };

  const emptyTrash = async () => {
    if (!supabase) return;
    if (!window.confirm("Permanently delete all trashed entries? This cannot be undone.")) return;
    setDeleting("trash");
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).delete().not("deleted_at", "is", null);
    if (error) {
      window.alert("Empty trash failed: " + error.message);
    } else {
      setDeleted([]);
    }
    setDeleting(null);
  };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 16 }}>
        Service Archives
      </div>

      {!supabase && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Supabase not connected</div>}
      {supabase && loading && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Loading...</div>}
      {supabase && !loading && entries.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>No archived services yet</div>}

      {supabase && !loading && entries.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button onClick={deleteAll} disabled={deleting === "all"} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
            border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
            opacity: deleting === "all" ? 0.5 : 1,
          }}>{deleting === "all" ? "MOVING TO TRASH..." : "DELETE ALL"}</button>
        </div>
      )}

      {entries.map(entry => {
        const isExp       = expanded === entry.id;
        const entryTables = entry.state?.tables || [];
        const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
        return (
          <div key={entry.id} style={{ border: "1px solid #f0f0f0", borderRadius: 4, marginBottom: 8, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isExp ? "#fafafa" : "#fff" }}>
              <div onClick={() => setExpanded(isExp ? null : entry.id)} style={{ cursor: "pointer", flex: 1 }}>
                <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: "#1a1a1a", marginBottom: 3 }}>{entry.label}</div>
                <div style={{ fontFamily: FONT, fontSize: 10, color: "#999" }}>{entryTables.length} tables · {totalGuests} guests</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => deleteEntry(entry.id)} disabled={deleting === entry.id} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                  border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
                  opacity: deleting === entry.id ? 0.5 : 1,
                }}>{deleting === entry.id ? "..." : "delete"}</button>
                <span onClick={() => setExpanded(isExp ? null : entry.id)} style={{ fontFamily: FONT, fontSize: 16, color: "#ccc", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.18s", display: "inline-block", cursor: "pointer" }}>⌄</span>
              </div>
            </div>
            {isExp && (
              <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px" }}>
                {entryTables.map(t => (
                  <div key={t.id} style={{ padding: "8px 0", borderBottom: "1px solid #f8f8f8" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 300, color: "#999" }}>{String(t.id).padStart(2, "0")}</span>
                      {t.resName && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{t.resName}</span>}
                      <span style={{ fontFamily: FONT, fontSize: 10, color: "#888" }}>{t.guests || 0} guests</span>
                      {t.menuType && <span style={{ fontFamily: FONT, fontSize: 9, color: "#9a9a9a", border: "1px solid #e0e0e0", borderRadius: 2, padding: "1px 6px" }}>{t.menuType}</span>}
                      {t.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: "#555" }}>{t.arrivedAt}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Recently Deleted (trash) */}
      {deleted.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button
              onClick={() => setShowTrash(v => !v)}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
            >
              Recently Deleted ({deleted.length}) {showTrash ? "▲" : "▼"}
            </button>
            {showTrash && (
              <button onClick={emptyTrash} disabled={deleting === "trash"} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "4px 12px",
                border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
                opacity: deleting === "trash" ? 0.5 : 1,
              }}>{deleting === "trash" ? "DELETING..." : "EMPTY TRASH"}</button>
            )}
          </div>
          {showTrash && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {deleted.map(entry => {
                const entryTables = entry.state?.tables || [];
                const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
                const deletedDate = entry.deleted_at ? new Date(entry.deleted_at).toLocaleDateString() : "";
                return (
                  <div key={entry.id} style={{ border: "1px solid #f5f0f0", borderRadius: 4, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fdf8f8", opacity: 0.8 }}>
                    <div>
                      <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: "#888" }}>{entry.label}</div>
                      <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 2 }}>{entryTables.length} tables · {totalGuests} guests · deleted {deletedDate}</div>
                    </div>
                    <button onClick={() => restoreEntry(entry.id)} disabled={deleting === entry.id} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "4px 12px",
                      border: "1px solid #b8d8c8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#555",
                      opacity: deleting === entry.id ? 0.5 : 1,
                    }}>{deleting === entry.id ? "..." : "RESTORE"}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
