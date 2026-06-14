// ── 3-way table merge ────────────────────────────────────────────────────────
// The heart of "proper sync". When a remote change for a table arrives while
// this device has its own unsaved change to the SAME table, the old code picked
// one side wholesale (last-write-wins on the whole row) — so two waiters editing
// different seats of one table clobbered each other. This merges instead:
//
//   ancestor = the last state both sides agreed on (last synced)
//   mine     = this device's current state
//   theirs   = the incoming remote state
//
// For every field, MY value wins only where I actually diverged from the
// ancestor; otherwise I take theirs. Seats merge per seat-id, and the
// kitchen-log / course-notes maps merge per key, so concurrent edits to
// different seats/courses of the same table both survive.

import { sanitizeTable } from "./tableHelpers.js";

const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

// Merge seats by id at whole-seat granularity: a seat I changed vs the ancestor
// wins; otherwise take the remote seat. (Two people editing the SAME seat is
// rare; different seats is the real case and merges cleanly.)
function mergeSeats(ancestor = [], mine = [], theirs = []) {
  const map = (arr) => new Map((Array.isArray(arr) ? arr : []).map((s) => [s.id, s]));
  const aM = map(ancestor), mM = map(mine), tM = map(theirs);
  const ids = [...new Set([...mM.keys(), ...tM.keys()])].sort((x, y) => x - y);
  return ids.map((id) => {
    const a = aM.get(id), m = mM.get(id), t = tM.get(id);
    if (m && differs(m, a)) return m;     // I edited this seat → keep mine
    if (t !== undefined) return t;        // otherwise take theirs
    return m;                             // theirs dropped it but I still have it
  });
}

// Merge an object keyed by string (kitchenLog, kitchenCourseNotes): keys I
// changed win; keys only theirs has are included; a key I removed (and they
// didn't touch) stays removed.
function mergeKeyed(ancestor = {}, mine = {}, theirs = {}) {
  const a = ancestor || {}, m = mine || {}, t = theirs || {};
  const out = { ...t };
  for (const k of Object.keys(m)) {
    if (differs(m[k], a[k])) out[k] = m[k];           // I changed/added this key
  }
  for (const k of Object.keys(a)) {
    if (!(k in m) && k in t && !differs(a[k], t[k])) {
      delete out[k];                                  // I removed it, they didn't touch it
    }
  }
  return out;
}

const KEYED_FIELDS = ["kitchenLog", "kitchenCourseNotes"];

export function mergeTable(ancestor, mine, theirs) {
  const a = sanitizeTable(ancestor || {});
  const m = sanitizeTable(mine || {});
  const t = sanitizeTable(theirs || {});

  const out = { ...t };
  const keys = new Set([...Object.keys(m), ...Object.keys(t)]);
  for (const k of keys) {
    if (k === "id") { out.id = m.id ?? t.id; continue; }
    if (k === "seats") { out.seats = mergeSeats(a.seats, m.seats, t.seats); continue; }
    if (KEYED_FIELDS.includes(k)) { out[k] = mergeKeyed(a[k], m[k], t[k]); continue; }
    out[k] = differs(m[k], a[k]) ? m[k] : t[k];       // top-level: mine wins iff I changed it
  }
  // sanitize last so the seat count tracks the merged `guests`
  return sanitizeTable(out);
}
