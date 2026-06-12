import { useEffect, useMemo, useState } from "react";
import { supabase, TABLES } from "../../lib/supabaseClient.js";
import { scopedFrom } from "../../lib/scopedDb.js";
import { findGuestHistory } from "../../utils/archiveInsights.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

// Recent archives, fetched once and shared across form opens (5 min TTL) —
// typing a guest name must not hammer Supabase with snapshot downloads.
let archiveCache = { at: 0, entries: null, promise: null };
const CACHE_TTL_MS = 5 * 60 * 1000;
const ARCHIVE_LIMIT = 20;

function loadRecentArchives() {
  const fresh = archiveCache.entries && Date.now() - archiveCache.at < CACHE_TTL_MS;
  if (fresh) return Promise.resolve(archiveCache.entries);
  if (archiveCache.promise) return archiveCache.promise;
  archiveCache.promise = scopedFrom(TABLES.SERVICE_ARCHIVE)
    .select("date, label, state")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(ARCHIVE_LIMIT)
    .then(({ data, error }) => {
      archiveCache.promise = null;
      if (error) return archiveCache.entries || [];
      archiveCache = { at: Date.now(), entries: data || [], promise: null };
      return archiveCache.entries;
    });
  return archiveCache.promise;
}

/**
 * Guest memory — shows what a returning guest had on previous visits, keyed
 * by the reservation name being typed. Pure hint, read-only, renders nothing
 * when there is no match.
 */
export default function GuestMemory({ name }) {
  const [entries, setEntries] = useState(archiveCache.entries);
  const [query, setQuery] = useState("");

  // Debounce the typed name so the scan (and first fetch) waits for a pause.
  useEffect(() => {
    const q = String(name || "").trim();
    if (q.length < 3) { setQuery(""); return undefined; }
    const id = setTimeout(() => setQuery(q), 400);
    return () => clearTimeout(id);
  }, [name]);

  useEffect(() => {
    if (!supabase || !query || entries) return undefined;
    let cancelled = false;
    loadRecentArchives().then(list => { if (!cancelled) setEntries(list); });
    return () => { cancelled = true; };
  }, [query, entries]);

  const visits = useMemo(
    () => (query && entries ? findGuestHistory(query, entries, { limit: 3 }) : []),
    [query, entries],
  );

  if (visits.length === 0) return null;

  return (
    <div style={{
      marginTop: 6, padding: "8px 10px", background: tokens.tint.parchment,
      border: `1px solid ${tokens.ink[4]}`,
    }}>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 5 }}>
        ↻ Returning guest · {visits.length} previous visit{visits.length === 1 ? "" : "s"}
      </div>
      {visits.map((v, i) => (
        <div key={`${v.label}-${i}`} style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], padding: "2px 0", lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>{v.label || v.date}</span>
          {" — "}{v.guests} guests
          {v.menuType ? ` · ${v.menuType}` : ""}
          {v.pairings.length > 0 ? ` · ${v.pairings.join(", ")}` : ""}
          {v.birthday ? " · 🎂" : ""}
          {v.restrictions.length > 0 && (
            <span style={{ color: tokens.red.text }}> · {v.restrictions.join(", ")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
