// ── Archive dedup (pure) ─────────────────────────────────────────────────────
// Deciding whether an end-of-service archive is a genuine new entry or a
// double-file of one already on record. The old rule keyed purely on
// date + label (label = "DD.MM.YYYY – SESSION"), so a LEGITIMATE second service
// run on the same calendar day and same session (e.g. a botched dinner ended
// and restarted) collided with the first and was silently dropped — the user
// lost the good service from the archive while the broken one stayed.
//
// Each service now carries a unique `startedAt` instance id. A true duplicate
// shares that id (same service, filed twice by a double-tap or a second
// device); a real second service has a different id and must be kept, with a
// distinct " · n" label so both are legible in the list.
//
// `startedAt` can be absent on legacy/orphaned services. In that case we fall
// back to a tight recency window: only a near-simultaneous same-label entry is
// treated as a race; anything older is assumed to be a separate service.

const RACE_WINDOW_MS = 2 * 60 * 1000;

/**
 * @param {object} args
 * @param {Array<{label?: string, created_at?: string, state?: object}>} args.existing
 *        non-deleted archives already on record for this service day whose label
 *        matches the base label (or its " · n" variants)
 * @param {string|null} args.startedAt  this service instance's id (may be null)
 * @param {string} args.archiveLabel    the base "DD.MM.YYYY – SESSION" label
 * @param {number} [args.now]           current epoch ms (injectable for tests)
 * @returns {{ isDuplicate: boolean, label: string }}
 */
export function resolveArchiveDedup({ existing = [], startedAt = null, archiveLabel, now = Date.now() }) {
  const rows = Array.isArray(existing) ? existing : [];

  const isDuplicate = rows.some((e) => {
    if (startedAt && e?.state?.startedAt) return e.state.startedAt === startedAt;
    // No instance id to compare → treat only a near-simultaneous file as a race.
    const t = e?.created_at ? new Date(e.created_at).getTime() : NaN;
    return Number.isFinite(t) && (now - t) < RACE_WINDOW_MS;
  });

  // Suffix the label so a genuine second service is distinguishable in the list.
  const label = rows.length > 0 ? `${archiveLabel} · ${rows.length + 1}` : archiveLabel;
  return { isDuplicate, label };
}

// Whether an archive row belongs to the same service slot (same base label, or
// one of its numbered " · n" variants). Used to gather the set passed to
// resolveArchiveDedup.
export function isSameServiceLabel(rowLabel, baseLabel) {
  if (!rowLabel || !baseLabel) return false;
  return rowLabel === baseLabel || rowLabel.startsWith(`${baseLabel} · `);
}
