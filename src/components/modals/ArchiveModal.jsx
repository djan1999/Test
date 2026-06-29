import { useEffect, useMemo, useState } from "react";
import FullModal from "../ui/FullModal.jsx";
import TableSummaryCard from "./TableSummaryCard.jsx";
import { KitchenTicket } from "../kitchen/KitchenBoard.jsx";
import { supabase, TABLES, getWorkspaceId } from "../../lib/supabaseClient.js";
import { scopedFrom } from "../../lib/scopedDb.js";
import { isPowerSyncEnabled } from "../../powersync/config.js";
import { parseHHMM, mergeTableGroups, tableGroupLabel } from "../../utils/tableHelpers.js";
import { optionalPairingsFromCourses } from "../../utils/menuUtils.js";
import { aggregateInsights } from "../../utils/archiveInsights.js";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

const FONT = tokens.font;

export default function ArchiveModal({
  tables,
  optionalExtras = [],
  optionalPairings = [],
  onArchiveAndClear,
  onClearAll,
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
    // PowerSync instant paint: when the on-device DB has synced, fill the archive
    // straight from local SQLite so the modal opens immediately; the Supabase
    // load below still runs as the source-of-truth refresh.
    if (isPowerSyncEnabled(getWorkspaceId())) {
      (async () => {
        try {
          const { whenSynced, readServiceArchive } = await import("../../powersync/reads.js");
          if (!(await whenSynced())) return;
          const { active, deleted } = await readServiceArchive();
          if (active.length || deleted.length) { setEntries(active); setDeleted(deleted); setLoading(false); }
        } catch { /* fall back to Supabase */ }
      })();
    }
    Promise.all([
      scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
      scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
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
    const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE).update({ deleted_at: new Date().toISOString() }).eq("id", id);
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
    const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE).update({ deleted_at: now }).is("deleted_at", null);
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
    const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE).update({ deleted_at: null }).eq("id", id);
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
    const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE).delete().not("deleted_at", "is", null);
    if (error) {
      alert("Empty trash failed: " + error.message);
    } else {
      setDeleted([]);
    }
    setDeleting(null);
  };

  const activeTables = mergeTableGroups(tables.filter((t) => t.active || t.arrivedAt || t.resName || t.resTime));

  const archiveActions = (
    <div style={{ display: "flex", gap: isMobile ? 6 : 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
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

  // Merge multi-table reservations (T02 + T03 → "T02-03" with all seats combined)
  // so the archive view doesn't show ghost rows for the secondary tables that
  // only carry empty placeholder seats.
  const archivedTickets = mergeTableGroups((tables || []).filter((t) => t.kitchenArchived));
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
                const label = tableGroupLabel(t);
                const guestCount = t._groupGuests || t.guests;
                return (
                  <div key={t.id} style={{ border: `1px solid ${tokens.green.border}`, borderRadius: 0, overflow: "hidden", background: tokens.green.bg }}>
                    <div
                      onClick={() => setExpandedTicket(isOpen ? null : t.id)}
                      style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 300, color: tokens.green.text, letterSpacing: 1 }}>{label}</span>
                        {t.resName && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.neutral[900] }}>{t.resName}</span>}
                        <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.border }}>{guestCount} guests</span>
                        {durMins != null && <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.text, fontWeight: 600 }}>{fmtDuration(durMins)}</span>}
                        {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.border }}>{timeRange}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!onRestoreTicket) return;
                            // Restore covers every table in the group, not just the primary,
                            // so secondaries stop showing as "archived" in service mode.
                            const ids = Array.isArray(t.tableGroup) && t.tableGroup.length > 1
                              ? t.tableGroup
                              : [t.id];
                            ids.forEach(id => onRestoreTicket(id));
                          }}
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
                            <TableSummaryCard table={t} groupLabel={label} optionalExtras={optionalExtras} optionalPairings={optionalPairings} />
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
        {supabase && !loading && entries.length > 0 && <InsightsSection entries={entries} />}
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
          // Merge tableGroup members so a past T02-03 reservation collapses to
          // one row across both the summary count and the per-table cards.
          const rawTables = entry.state?.tables || [];
          const entryTables = mergeTableGroups(rawTables);
          const entryMenuCourses = entry.state?.menuCourses || [];
          const entryOptionalPairings = optionalPairingsFromCourses(entryMenuCourses);
          const totalGuests = entryTables.reduce((a, t) => a + (t._groupGuests || t.guests || 0), 0);
          // Drink summary still walks the merged list — bottles, glasses, etc.
          // have already been concatenated by mergeTableGroups, so this matches
          // what the user sees in the per-table cards below.
          const drinks = archiveDrinkSummary(entryTables);
          return (
            <div key={entry.id} style={{ border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isExp ? tokens.neutral[50] : tokens.neutral[0] }}>
                <div onClick={() => setExpanded(isExp ? null : entry.id)} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: tokens.neutral[900], marginBottom: 3 }}>{entry.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500] }}>
                    {entryTables.length} tables · {totalGuests} guests · {drinks.total} drink{drinks.total === 1 ? "" : "s"}
                  </div>
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
                <div style={{ borderTop: `1px solid ${tokens.neutral[200]}`, padding: "12px 16px", background: tokens.neutral[0] }}>
                  <ArchiveSummary tableCount={entryTables.length} totalGuests={totalGuests} drinks={drinks} />
                  {entryTables.map((t) => (
                    <ArchivedTableRow key={t.id} table={t} optionalExtras={optionalExtras} optionalPairings={entryOptionalPairings} menuCourses={entryMenuCourses} />
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
                  const entryTables = mergeTableGroups(entry.state?.tables || []);
                  const totalGuests = entryTables.reduce((a, t) => a + (t._groupGuests || t.guests || 0), 0);
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

// ── Insights — what the archives can teach us ────────────────────────────────
// Aggregates the loaded archive entries into service intelligence: covers,
// course rhythm, pairing uptake, and the chronically slow courses. Computed
// lazily on expand — the math walks every seat of every archived table.
function InsightsSection({ entries }) {
  const [open, setOpen] = useState(false);
  const insights = useMemo(() => (open ? aggregateInsights(entries) : null), [open, entries]);

  const fmtMins = (m) => {
    if (m == null) return "—";
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m} min`;
  };

  return (
    <div style={{ border: `1px solid ${tokens.neutral[200]}`, marginBottom: 16 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", textAlign: "left", padding: "12px 16px", cursor: "pointer",
          background: open ? tokens.neutral[50] : tokens.neutral[0], border: "none",
          fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: tokens.neutral[700],
          textTransform: "uppercase", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <span>Insights · last {entries.length} service{entries.length === 1 ? "" : "s"}</span>
        <span style={{ fontSize: 14, color: tokens.neutral[300], transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>⌄</span>
      </button>
      {open && insights && (
        <div style={{ borderTop: `1px solid ${tokens.neutral[200]}`, padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <SummaryBadge label="services" value={insights.services} />
            <SummaryBadge label="covers" value={insights.totalCovers} />
            <SummaryBadge label="avg covers / service" value={insights.avgCovers} />
            {insights.medianGap != null && <SummaryBadge label="median course gap" value={`${insights.medianGap} min`} />}
            {insights.medianDuration != null && <SummaryBadge label="median dinner" value={fmtMins(insights.medianDuration)} />}
            {insights.pairingPct != null && <SummaryBadge label={`pairing uptake (${insights.pairingSeats} seats)`} value={`${insights.pairingPct}%`} />}
          </div>

          {insights.slowestCourses.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[500], textTransform: "uppercase", marginBottom: 6 }}>
                Slowest courses (median wait before fire)
              </div>
              {insights.slowestCourses.slice(0, 5).map((c, i) => (
                <div key={c.name} style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[700], padding: "3px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{i + 1}. {c.name}</span>
                  <span style={{ color: i === 0 ? tokens.red.text : tokens.neutral[500], whiteSpace: "nowrap" }}>
                    ~{c.medianGap} min · {c.samples} fires
                  </span>
                </div>
              ))}
            </div>
          )}

          <div>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[500], textTransform: "uppercase", marginBottom: 6 }}>
              Per service
            </div>
            {insights.perEntry.map((e, i) => (
              <div key={`${e.label}-${i}`} style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[500], padding: "2px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: tokens.neutral[700] }}>{e.label}</span>
                <span style={{ whiteSpace: "nowrap" }}>
                  {e.covers} covers{e.medianGap != null ? ` · ~${Math.round(e.medianGap)} min/course` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {open && !insights && (
        <div style={{ borderTop: `1px solid ${tokens.neutral[200]}`, padding: "14px 16px", fontFamily: FONT, fontSize: 10, color: tokens.neutral[400], fontStyle: "italic" }}>
          Not enough archived data to analyse yet.
        </div>
      )}
    </div>
  );
}

// Aggregate per-seat drink selections across every table in an archived service.
function archiveDrinkSummary(tables) {
  const s = { aperitifs: 0, glasses: 0, bottles: 0, cocktails: 0, spirits: 0, beers: 0, pairings: 0 };
  for (const t of tables || []) {
    for (const seat of t.seats || []) {
      s.aperitifs += (seat.aperitifs || []).filter(Boolean).length;
      s.glasses   += (seat.glasses   || []).filter(Boolean).length;
      s.cocktails += (seat.cocktails || []).filter(Boolean).length;
      s.spirits   += (seat.spirits   || []).filter(Boolean).length;
      s.beers     += (seat.beers     || []).filter(Boolean).length;
      // Pairing tags (Wine / Non-Alc / Premium / Our Story) and linked
      // optional pairings are kitchen-driven drink decisions, not just
      // labels — count them so a wine-pairing-heavy lunch doesn't look
      // like "0 drinks" when every guest actually ordered a pairing.
      const p = String(seat.pairing || "").trim();
      if (p && p !== "—") s.pairings += 1;
      const op = seat.optionalPairings || {};
      for (const k of Object.keys(op)) {
        if (op[k]?.ordered) s.pairings += 1;
      }
    }
    s.bottles += (t.bottleWines || []).length;
  }
  s.total = s.aperitifs + s.glasses + s.bottles + s.cocktails + s.spirits + s.beers + s.pairings;
  return s;
}

function SummaryBadge({ label, value }) {
  return (
    <span style={{
      fontFamily: FONT, fontSize: 10, padding: "4px 9px",
      border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0,
      color: tokens.neutral[700], background: tokens.neutral[50],
    }}>
      <strong style={{ fontWeight: 700, color: tokens.neutral[900] }}>{value}</strong> {label}
    </span>
  );
}

function ArchiveSummary({ tableCount, totalGuests, drinks }) {
  const breakdown = [
    ["Pairings", drinks.pairings],
    ["Aperitifs", drinks.aperitifs],
    ["Glasses", drinks.glasses],
    ["Bottles", drinks.bottles],
    ["Cocktails", drinks.cocktails],
    ["Spirits", drinks.spirits],
    ["Beers", drinks.beers],
  ].filter(([, n]) => n > 0);
  return (
    <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${tokens.neutral[200]}` }}>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: tokens.neutral[500], textTransform: "uppercase", marginBottom: 8 }}>Service summary</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <SummaryBadge label="Tables" value={tableCount} />
        <SummaryBadge label="Guests" value={totalGuests} />
        <SummaryBadge label="Drinks" value={drinks.total} />
        {breakdown.map(([label, n]) => <SummaryBadge key={label} label={label} value={n} />)}
      </div>
      {drinks.total === 0 && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.neutral[400], marginTop: 8, fontStyle: "italic" }}>
          No drinks were logged for this service.
        </div>
      )}
    </div>
  );
}

function ArchivedTableRow({ table, optionalExtras, optionalPairings = [], menuCourses }) {
  const isMobile = useIsMobile(640);
  const [showTicket, setShowTicket] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <TableSummaryCard table={table} groupLabel={tableGroupLabel(table)} optionalExtras={optionalExtras} optionalPairings={optionalPairings} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8, marginBottom: 4 }}>
        <button
          onClick={() => setShowTicket((v) => !v)}
          style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "3px 10px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[500], textTransform: "uppercase" }}
        >
          {showTicket ? "Hide ticket" : "Show ticket"}
        </button>
      </div>
      {showTicket && (
        <div style={{ width: isMobile ? "100%" : 248, marginTop: 6 }}>
          <KitchenTicket table={table} menuCourses={menuCourses} upd={null} />
        </div>
      )}
    </div>
  );
}
