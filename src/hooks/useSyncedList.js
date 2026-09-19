import { useState } from "react";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Rebase an editor's changes on the latest catalogue. Only edits to the same
// field (or editing a deleted row) require a decision; unrelated edits compose.
export function mergeListDraft(base, local, remote) {
  const before = new Map(base.map(row => [String(row.id), row]));
  const ours = new Map(local.map(row => [String(row.id), row]));
  const theirs = new Map(remote.map(row => [String(row.id), row]));
  const rows = []; let conflict = false;
  for (const id of new Set([...theirs.keys(), ...ours.keys()])) {
    const b = before.get(id), l = ours.get(id), r = theirs.get(id);
    if (equal(l, b)) { if (r) rows.push(r); continue; }
    if (equal(r, b) || equal(l, r)) { if (l) rows.push(l); continue; }
    if (!l || !r || !b) { conflict = true; if (l) rows.push(l); continue; }
    const row = { ...r };
    for (const field of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      if (equal(l[field], b[field])) continue;
      if (!equal(r[field], b[field]) && !equal(r[field], l[field])) conflict = true;
      if (field in l) row[field] = l[field]; else delete row[field];
    }
    rows.push(row);
  }
  return { rows, conflict };
}

export function useSyncedList(remote) {
  const [state, setState] = useState(() => ({ base: remote, rows: remote, conflict: false }));
  if (!equal(state.base, remote)) {
    const next = mergeListDraft(state.base, state.rows, remote);
    setState({ base: remote, rows: next.rows, conflict: state.conflict || next.conflict });
  }
  const setRows = next => setState(prev => ({ ...prev,
    rows: typeof next === "function" ? next(prev.rows) : next,
  }));
  const reset = () => setState({ base: remote, rows: remote, conflict: false });
  return [state.rows, setRows, state.conflict, reset];
}
