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
import { useIsMobile } from "../../hooks/useIsMobile.js";

const FONT = tokens.font;
const PAIRING_COLOR = { Wine: tokens.text.body, "Non-Alc": tokens.neutral[500], Premium: tokens.neutral[500], "Our Story": tokens.green.text };
const PAIRING_BG = { Wine: tokens.tint.parchment, "Non-Alc": tokens.neutral[50], Premium: tokens.neutral[50], "Our Story": tokens.green.bg };

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
  const isMobile = useIsMobile(640);
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
    <div style={{ display: "flex", gap: isMobile ? 6 : 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button onClick={onSeedTest} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: isMobile ? 1.5 : 2, padding: isMobile ? "6px 10px" : "8px 14px",
        border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer", background: tokens.green.bg, color: tokens.green.text,
      }}>{isMobile ? "SEED" : "SEED TEST"}</button>
      <button onClick={onClearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: isMobile ? 1.5 : 2, padding: isMobile ? "6px 10px" : "8px 14px",
        border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[500],
      }}>{isMobile ? "CLEAR" : "CLEAR ALL"}</button>
      <button onClick={async () => { await onArchiveAndClear(); loadEntries(); }} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: isMobile ? 1.5 : 2, padding: isMobile ? "6px 10px" : "8px 16px",
        border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.tint.parchment, color: tokens.text.body,
      }}>{isMobile ? `ARCHIVE (${activeTables.length})` : `ARCHIVE & CLEAR (${activeTables.length})`}</button>
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
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[500], textTransform: "uppercase", marginBottom: 10 }}>Today · Archived Tickets</div>
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
                  <div key={t.id} style={{ border: `1px solid ${tokens.green.border}`, borderRadius: 0, overflow: "hidden", background: tokens.green.bg }}>
                    <div
                      onClick={() => setExpandedTicket(isOpen ? null : t.id)}
                      style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 300, color: tokens.green.text, letterSpacing: 1 }}>{String(t.id).padStart(2, "0")}</span>
                        {t.resName && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.neutral[900] }}>{t.resName}</span>}
                        <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.border }}>{t.guests} guests</span>
                        {durMins != null && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.text, fontWeight: 600 }}>{fmtDuration(durMins)}</span>}
                        {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.border }}>{timeRange}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onRestoreTicket && onRestoreTicket(t.id); }}
                          style={{
                            fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 12px",
                            border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                            background: tokens.neutral[0], color: tokens.green.text, textTransform: "uppercase",
                          }}
                        >Restore</button>
                        <span style={{ fontFamily: FONT, fontSize: 14, color: tokens.green.border, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>⌄</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${tokens.green.border}`, padding: "12px 14px", background: tokens.neutral[0] }}>
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div style={{ width: isMobile ? "100%" : 248, flexShrink: 0 }}>
                            <KitchenTicket table={t} menuCourses={menuCourses} upd={null} />
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            {(t.bottleWines || []).length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.neutral[400], textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
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
                                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.neutral[900], letterSpacing: 0.3 }}>🍾 {title}</span>
                                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[500] }}>{sub}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.neutral[400], textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
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
                                <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: `1px solid ${tokens.neutral[100]}` }}>
                                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: tokens.neutral[500], minWidth: 26 }}>P{s.id}</span>
                                  {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, background: ws.bg || tokens.neutral[100], color: tokens.neutral[700], border: `1px solid ${tokens.neutral[200]}` }}>{s.water}</span>}
                                  {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, color: PAIRING_COLOR[s.pairing] || tokens.neutral[600], background: PAIRING_BG[s.pairing] || tokens.neutral[50], border: `1px solid ${tokens.neutral[200]}` }}>{s.pairing}</span>}
                                  {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                  {extra.map((d) => <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg }}>{d.name}</span>)}
                                  {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${tokens.red.border}`, color: tokens.red.text, background: tokens.red.bg }}>⚠ {restrLabel(r.note)}</span>)}
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

        {!supabase && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], padding: "60px 0", textAlign: "center" }}>Supabase not connected</div>}
        {supabase && loading && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], padding: "60px 0", textAlign: "center" }}>Loading…</div>}
        {supabase && !loading && entries.length === 0 && archivedTickets.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], padding: "60px 0", textAlign: "center" }}>No archived services yet</div>}
        {supabase && !loading && entries.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button onClick={deleteAll} disabled={deleting === "all"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
              border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text,
              opacity: deleting === "all" ? 0.5 : 1,
            }}>{deleting === "all" ? "MOVING TO TRASH…" : "DELETE ALL"}</button>
          </div>
        )}
        {entries.map((entry) => {
          const isExp = expanded === entry.id;
          const entryTables = entry.state?.tables || [];
          const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
          return (
            <div key={entry.id} style={{ border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isExp ? tokens.neutral[50] : tokens.neutral[0] }}>
                <div onClick={() => setExpanded(isExp ? null : entry.id)} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: tokens.neutral[900], marginBottom: 3 }}>{entry.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500] }}>{entryTables.length} tables · {totalGuests} guests</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => deleteEntry(entry.id)} disabled={deleting === entry.id} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                    border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text,
                    opacity: deleting === entry.id ? 0.5 : 1,
                  }}>{deleting === entry.id ? "…" : "delete"}</button>
                  <span onClick={() => setExpanded(isExp ? null : entry.id)} style={{ fontFamily: FONT, fontSize: 16, color: tokens.neutral[300], transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.18s", display: "inline-block", cursor: "pointer" }}>⌄</span>
                </div>
              </div>
              {isExp && (
                <div style={{ borderTop: `1px solid ${tokens.neutral[200]}` }}>
                  {entryTables.map((t) => (
                    <div key={t.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.neutral[50]}` }}>
                      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ width: 248, flexShrink: 0 }}>
                          <KitchenTicket table={t} menuCourses={entry.state?.menuCourses || []} upd={null} />
                        </div>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          {(t.bottleWines || []).length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.neutral[400], textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
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
                                    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: tokens.neutral[900], letterSpacing: 0.3 }}>🍾 {title}</span>
                                    {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[500] }}>{sub}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.neutral[400], textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
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
                              <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: `1px solid ${tokens.neutral[50]}` }}>
                                <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: tokens.neutral[500], minWidth: 26 }}>P{s.id}</span>
                                {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, background: ws.bg || tokens.neutral[100], color: tokens.neutral[700], border: `1px solid ${tokens.neutral[200]}` }}>{s.water}</span>}
                                {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, color: PAIRING_COLOR[s.pairing] || tokens.neutral[600], background: PAIRING_BG[s.pairing] || tokens.neutral[50], border: `1px solid ${tokens.neutral[200]}` }}>{s.pairing}</span>}
                                {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                {extra.map((d) => <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg }}>{d.name}</span>)}
                                {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 0, border: `1px solid ${tokens.red.border}`, color: tokens.red.text, background: tokens.red.bg }}>⚠ {restrLabel(r.note)}</span>)}
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
                style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[400], background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
              >
                Recently Deleted ({deleted.length}) {showTrash ? "▲" : "▼"}
              </button>
              {showTrash && (
                <button onClick={emptyTrash} disabled={deleting === "trash"} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "4px 12px",
                  border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text,
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
                    <div key={entry.id} style={{ border: `1px solid ${tokens.red.bg}`, borderRadius: 0, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: tokens.red.bg, opacity: 0.8 }}>
                      <div>
                        <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: tokens.neutral[500] }}>{entry.label}</div>
                        <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.neutral[400], marginTop: 2 }}>{entryTables.length} tables · {totalGuests} guests · deleted {deletedDate}</div>
                      </div>
                      <button onClick={() => restoreEntry(entry.id)} disabled={deleting === entry.id} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "4px 12px",
                        border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.green.text,
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
