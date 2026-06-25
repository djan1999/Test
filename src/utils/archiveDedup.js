// ── Archive labelling ────────────────────────────────────────────────────────
// Every end-of-service archive is SAVED — we never silently skip one as a
// "duplicate" (losing a real service to that skip is worse than keeping an
// occasional double that can be deleted by hand). When an archive for the same
// service day + session already exists, the new one gets a distinct " · n"
// suffix so both are legible in the list.

// Whether an archive row belongs to the same service slot (same base label, or
// one of its numbered " · n" variants).
export function isSameServiceLabel(rowLabel, baseLabel) {
  if (!rowLabel || !baseLabel) return false;
  return rowLabel === baseLabel || rowLabel.startsWith(`${baseLabel} · `);
}

/**
 * The label to file the next archive under. Always returns a label (we always
 * save); adds " · n" when prior archives for this day+session already exist.
 * @param {Array<{label?: string}>} existing  same-day archives sharing the base label
 * @param {string} archiveLabel  the base "DD.MM.YYYY – SESSION" label
 * @returns {string}
 */
export function nextArchiveLabel(existing = [], archiveLabel) {
  const rows = Array.isArray(existing) ? existing : [];
  const sameSlot = rows.filter((e) => isSameServiceLabel(e.label, archiveLabel));
  return sameSlot.length > 0 ? `${archiveLabel} · ${sameSlot.length + 1}` : archiveLabel;
}
