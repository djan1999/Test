import { useEffect, useState } from "react";
import FullModal from "../ui/FullModal.jsx";
import { KitchenTicket } from "../kitchen/KitchenBoard.jsx";
import { supabase, TABLES } from "../../lib/supabaseClient.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { COUNTRY_NAMES } from "../../constants/countries.js";
import { restrLabel } from "../../constants/dietary.js";
import { waterStyle } from "../../constants/pairings.js";
import { parseHHMM } from "../../utils/tableHelpers.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const PAIRING_COLOR = { Wine: "#8a6030", "Non-Alc": "#1f5f73", Premium: "#3a3a7a", "Our Story": "#2a6a4a" };
const PAIRING_BG = { Wine: "#fdf4e8", "Non-Alc": "#e8f7fb", Premium: "#eaeaf5", "Our Story": "#e0f5ea" };

export default function ArchiveModal({
  tables,
  optionalExtras = [],
  onArchiveAndClear,
  onClearAll,
  onSeedTest,
  onClose,
  onRestoreTicket,
  menuCourses,
}) {
  const [entries, setEntries] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showTrash, setShowTrash] = useState(false);

  const loadEntries = () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
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

  const deleteEntry = async (id) => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable UPDATE on the service_archive table in Supabase (Policies → anon → UPDATE).");
    } else {
      const entry = entries.find((x) => x.id === id);
      setEntries((e) => e.filter((x) => x.id !== id));
      if (entry) setDeleted((d) => [{ ...entry, deleted_at: new Date().toISOString() }, ...d]);
      if (expanded === id) setExpanded(null);
    }
    setDeleting(null);
  };

  const deleteAll = async () => {
    if (!supabase) return;
    if (!window.confirm("Move ALL archive entries to trash? You can restore them from Recently Deleted.")) return;
    setDeleting("all");
    const now = new Date().toISOString();
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: now }).is("deleted_at", null);
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable UPDATE on the service_archive table in Supabase (Policies → anon → UPDATE).");
    } else {
      setDeleted((d) => [...entries.map((e) => ({ ...e, deleted_at: now })), ...d]);
      setEntries([]);
      setExpanded(null);
    }
    setDeleting(null);
  };

  const restoreEntry = async (id) => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).update({ deleted_at: null }).eq("id", id);
    if (error) {
      alert("Restore failed: " + error.message);
    } else {
      const entry = deleted.find((x) => x.id === id);
      setDeleted((d) => d.filter((x) => x.id !== id));
      if (entry) setEntries((e) => [{ ...entry, deleted_at: null }, ...e].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    setDeleting(null);
  };

  const emptyTrash = async () => {
    if (!supabase) return;
    if (!window.confirm("Permanently delete all trashed entries? This cannot be undone.")) return;
    setDeleting("trash");
    const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).delete().not("deleted_at", "is", null);
    if (error) {
      alert("Empty trash failed: " + error.message);
    } else {
      setDeleted([]);
    }
    setDeleting(null);
  };

  const activeTables = tables.filter((t) => t.active || t.arrivedAt || t.resName || t.resTime);

  const archiveActions = (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onSeedTest} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 14px",
        border: "1px solid #b0d8b0", borderRadius: 0, cursor: "pointer", background: "#f0fbf0", color: "#307030",
      }}>SEED TEST</button>
      <button onClick={onClearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 14px",
        border: "1px solid #e8e8e8", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#888",
      }}>CLEAR ALL</button>
      <button onClick={async () => { await onArchiveAndClear(); loadEntries(); }} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
        border: "1px solid #c8a06e", borderRadius: 0, cursor: "pointer", background: "#fdf8f0", color: "#8a6030",
      }}>ARCHIVE & CLEAR ({activeTables.length})</button>
    </div>
  );

  const archivedTickets = (tables || []).filter((t) => t.kitchenArchived);
  const [expandedTicket, setExpandedTicket] = useState(null);
  const fmtDuration = (mins) => {
    if (mins == null) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <FullModal title="Archive · End of Day" onClose={onClose} actions={archiveActions}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {archivedTickets.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#888", textTransform: "uppercase", marginBottom: 10 }}>Today · Archived Tickets</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {archivedTickets.map((t) => {
                const klog = t.kitchenLog || {};
                const lastFiredAt = Object.values(klog).map((e) => e.firedAt).filter(Boolean).sort().pop();
                const start = parseHHMM(t.arrivedAt);
                const end = parseHHMM(lastFiredAt);
                const durMins = (start != null && end != null) ? (end >= start ? end - start : end - start + 1440) : null;
                const timeRange = t.arrivedAt && lastFiredAt ? `${t.arrivedAt}–${lastFiredAt}` : null;
                const isOpen = expandedTicket === t.id;
                return (
                  <div key={t.id} style={{ border: "1px solid #d8edd8", borderRadius: 0, overflow: "hidden", background: "#f6fbf6" }}>
                    <div
                      onClick={() => setExpandedTicket(isOpen ? null : t.id)}
                      style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 300, color: "#2a6a4a", letterSpacing: 1 }}>{String(t.id).padStart(2, "0")}</span>
                        {t.resName && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{t.resName}</span>}
                        <span style={{ fontFamily: FONT, fontSize: 10, color: "#6a9a7a" }}>{t.guests} guests</span>
                        {durMins != null && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 600 }}>{fmtDuration(durMins)}</span>}
                        {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: "#8ab89a" }}>{timeRange}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onRestoreTicket && onRestoreTicket(t.id); }}
                          style={{
                            fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 12px",
                            border: "1px solid #a8d8b8", borderRadius: 0, cursor: "pointer",
                            background: "#fff", color: "#4a9a6a", textTransform: "uppercase",
                          }}
                        >Restore</button>
                        <span style={{ fontFamily: FONT, fontSize: 14, color: "#8ab89a", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>⌄</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: "1px solid #d8edd8", padding: "12px 14px", background: "#fff" }}>
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div style={{ width: 248, flexShrink: 0 }}>
                            <KitchenTicket table={t} menuCourses={menuCourses} upd={null} />
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            {(t.bottleWines || []).length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
                                {(t.bottleWines || []).map((w, wi) => {
                                  const rawVintage = String(w?.vintage || "").trim();
                                  const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                                  const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                                  const rawCountry = w?.country || "";
                                  const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                                  const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                                  const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                                  return (
                                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
                                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.3 }}>🍾 {title}</span>
                                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
                            {(t.seats || []).map((s) => {
                              const ws = waterStyle(s.water);
                              const restr = (t.restrictions || []).filter((r) => r.pos === s.id);
                              const extra = (optionalExtras || []).filter((d) => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
                              const bevs = [
                                ...(s.aperitifs || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                                ...(s.glasses || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.wine })),
                                ...(s.cocktails || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                                ...(s.spirits || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.spirit })),
                                ...(s.beers || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.beer })),
                              ];
                              return (
                                <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #f5f5f5" }}>
                                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#999", minWidth: 26 }}>P{s.id}</span>
                                  {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, background: ws.bg || "#f0f0f0", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                                  {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa", border: "1px solid #e0e0e0" }}>{s.pairing}</span>}
                                  {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                  {extra.map((d) => <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}</span>)}
                                  {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!supabase && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Supabase not connected</div>}
        {supabase && loading && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Loading…</div>}
        {supabase && !loading && entries.length === 0 && archivedTickets.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>No archived services yet</div>}
        {supabase && !loading && entries.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button onClick={deleteAll} disabled={deleting === "all"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
              border: "1px solid #ffcccc", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#e07070",
              opacity: deleting === "all" ? 0.5 : 1,
            }}>{deleting === "all" ? "MOVING TO TRASH…" : "DELETE ALL"}</button>
          </div>
        )}
        {entries.map((entry) => {
          const isExp = expanded === entry.id;
          const entryTables = entry.state?.tables || [];
          const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
          return (
            <div key={entry.id} style={{ border: "1px solid #f0f0f0", borderRadius: 0, marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isExp ? "#fafafa" : "#fff" }}>
                <div onClick={() => setExpanded(isExp ? null : entry.id)} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: "#1a1a1a", marginBottom: 3 }}>{entry.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: "#999" }}>{entryTables.length} tables · {totalGuests} guests</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => deleteEntry(entry.id)} disabled={deleting === entry.id} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                    border: "1px solid #ffcccc", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#e07070",
                    opacity: deleting === entry.id ? 0.5 : 1,
                  }}>{deleting === entry.id ? "…" : "delete"}</button>
                  <span onClick={() => setExpanded(isExp ? null : entry.id)} style={{ fontFamily: FONT, fontSize: 16, color: "#ccc", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.18s", display: "inline-block", cursor: "pointer" }}>⌄</span>
                </div>
              </div>
              {isExp && (
                <div style={{ borderTop: "1px solid #f0f0f0" }}>
                  {entryTables.map((t) => (
                    <div key={t.id} style={{ padding: "12px 16px", borderBottom: "1px solid #f8f8f8" }}>
                      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ width: 248, flexShrink: 0 }}>
                          <KitchenTicket table={t} menuCourses={entry.state?.menuCourses || []} upd={null} />
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          {(t.bottleWines || []).length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
                              {(t.bottleWines || []).map((w, wi) => {
                                const rawVintage = String(w?.vintage || "").trim();
                                const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                                const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                                const rawCountry = w?.country || "";
                                const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                                const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                                const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                                return (
                                  <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
                                    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.3 }}>🍾 {title}</span>
                                    {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
                          {(t.seats || []).map((s) => {
                            const ws = waterStyle(s.water);
                            const restr = (t.restrictions || []).filter((r) => r.pos === s.id);
                            const extra = (optionalExtras || []).filter((d) => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
                            const bevs = [
                              ...(s.aperitifs || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                              ...(s.glasses || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.wine })),
                              ...(s.cocktails || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                              ...(s.spirits || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.spirit })),
                              ...(s.beers || []).filter(Boolean).map((x) => ({ label: x.name, ts: BEV_TYPES.beer })),
                            ];
                            return (
                              <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #fafafa" }}>
                                <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#999", minWidth: 26 }}>P{s.id}</span>
                                {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, background: ws.bg || "#f0f0f0", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                                {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa", border: "1px solid #e0e0e0" }}>{s.pairing}</span>}
                                {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                {extra.map((d) => <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}</span>)}
                                {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {deleted.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button
                onClick={() => setShowTrash((v) => !v)}
                style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
              >
                Recently Deleted ({deleted.length}) {showTrash ? "▲" : "▼"}
              </button>
              {showTrash && (
                <button onClick={emptyTrash} disabled={deleting === "trash"} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "4px 12px",
                  border: "1px solid #ffcccc", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#e07070",
                  opacity: deleting === "trash" ? 0.5 : 1,
                }}>{deleting === "trash" ? "DELETING…" : "EMPTY TRASH"}</button>
              )}
            </div>
            {showTrash && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {deleted.map((entry) => {
                  const entryTables = entry.state?.tables || [];
                  const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
                  const deletedDate = entry.deleted_at ? new Date(entry.deleted_at).toLocaleDateString() : "";
                  return (
                    <div key={entry.id} style={{ border: "1px solid #f5f0f0", borderRadius: 0, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fdf8f8", opacity: 0.8 }}>
                      <div>
                        <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: "#888" }}>{entry.label}</div>
                        <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 2 }}>{entryTables.length} tables · {totalGuests} guests · deleted {deletedDate}</div>
                      </div>
                      <button onClick={() => restoreEntry(entry.id)} disabled={deleting === entry.id} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "4px 12px",
                        border: "1px solid #b8d8c8", borderRadius: 0, cursor: "pointer", background: "#fff", color: "#4a9a6a",
                        opacity: deleting === entry.id ? 0.5 : 1,
                      }}>{deleting === entry.id ? "…" : "RESTORE"}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </FullModal>
  );
}
