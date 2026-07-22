// Pure helpers for the SERVICE ENTITY model. No store access — everything
// here is deterministic and unit-testable.
//
// A service is a row: { id, workspace_id, date, session, chosen_on,
// started_at, status: 'live'|'ended', ended_at, end_reason, label, snapshot,
// deleted_at, updated_at }. START inserts one; END flips status on that one
// row. Board rows (service_tables) carry the service_id they belong to, so no
// operation can ever touch another service's data — the property that makes
// the old wipe class structurally impossible.

import { sanitizeTable } from "../utils/tableHelpers.js";
import { nextArchiveLabel } from "../utils/archiveDedup.js";

const asObject = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }
  return null;
};

// Normalise a services row from either store (SQLite text columns or
// PostgREST) — or an already-sanitized entity (idempotent, so adapters can
// take either shape). Returns null for rows without the identity fields.
export function sanitizeService(row) {
  if (!row || !row.id) return null;
  const session = row.session === "lunch" || row.session === "dinner" ? row.session : "dinner";
  const status = row.status === "ended" ? "ended" : "live";
  const pick = (snake, camel) => row[snake] ?? row[camel] ?? null;
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  return {
    id: String(row.id),
    workspace_id: row.workspace_id ? String(row.workspace_id) : null,
    date: day(row.date),
    session,
    chosenOn: day(pick("chosen_on", "chosenOn")),
    startedAt: pick("started_at", "startedAt"),
    status,
    endedAt: pick("ended_at", "endedAt"),
    endReason: pick("end_reason", "endReason"),
    label: row.label || null,
    snapshot: asObject(row.snapshot),
    deletedAt: pick("deleted_at", "deletedAt"),
    updatedAt: pick("updated_at", "updatedAt"),
  };
}

// The service every device should show: the LIVE row with the newest
// started_at (ties broken by id so all devices pick the same one). The
// single-live trigger converges the store to at most one, but between a
// start and its supersede echo two can coexist briefly.
export function currentServiceFrom(rows) {
  const live = (rows || [])
    .map(sanitizeService)
    .filter((s) => s && s.status === "live" && s.date);
  if (live.length === 0) return null;
  return live.sort((a, b) => {
    const at = Date.parse(a.startedAt || "") || 0;
    const bt = Date.parse(b.startedAt || "") || 0;
    if (at !== bt) return bt - at;
    return a.id < b.id ? 1 : -1;
  })[0];
}

// "22. 07. 2026 – DINNER" — the archive label base for a service.
export function serviceLabelBase(date, session) {
  const d = new Date(`${date}T00:00:00`);
  const dateStr = Number.isFinite(d.getTime())
    ? d.toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" })
    : String(date);
  return `${dateStr} – ${String(session || "dinner").toUpperCase()}`;
}

// Label for an ENDING service, deduplicated against the other same-day
// entries ("… · 2" when the base label is taken). `sameDayLabels` is a list
// of { label } from BOTH ended services and legacy archive rows of that date.
export function nextServiceLabel(service, sameDayLabels) {
  const base = serviceLabelBase(service.date, service.session);
  return nextArchiveLabel(sameDayLabels || [], base);
}

// Present an ended service in the legacy archive-entry shape the archive
// surfaces (ArchiveModal, ArchivePanel, GuestMemory, insights) consume:
// { id, date, label, state: { tables, … }, created_at, deleted_at }.
// `_kind: "service"` lets the store seam route mutations to the right table.
export function archiveEntryFromService(service, tableRows) {
  const svc = sanitizeService(service);
  if (!svc) return null;
  const snapshot = svc.snapshot || {};
  // Every stored row rides along — the new model never writes blank rows, so
  // a row's existence means staff touched that table during the service.
  const tables = (tableRows || [])
    .map((row) => sanitizeTable({ id: Number(row.table_id), ...(asObject(row.data) || {}) }))
    .sort((a, b) => a.id - b.id);
  return {
    id: svc.id,
    _kind: "service",
    workspace_id: svc.workspace_id,
    date: svc.date,
    label: svc.label || serviceLabelBase(svc.date, svc.session),
    created_at: svc.endedAt || svc.startedAt || svc.updatedAt,
    deleted_at: svc.deletedAt,
    state: {
      tables,
      serviceSession: svc.session,
      startedAt: svc.startedAt,
      endReason: svc.endReason,
      menuCourses: Array.isArray(snapshot.menuCourses) ? snapshot.menuCourses : [],
      cocktails: Array.isArray(snapshot.cocktails) ? snapshot.cocktails : [],
      spirits: Array.isArray(snapshot.spirits) ? snapshot.spirits : [],
      beers: Array.isArray(snapshot.beers) ? snapshot.beers : [],
      autoEnded: svc.endReason === "rollover" || undefined,
    },
  };
}

// Merge ended services (adapted) with legacy service_archive rows into the
// { active, deleted } shape the archive surfaces consume — active newest-first
// capped at 60, trash newest-first capped at 30 (the legacy caps).
export function mergeArchiveEntries({ serviceEntries = [], legacyActive = [], legacyDeleted = [] }) {
  const legacy = (rows) => (rows || []).map((row) => ({ ...row, _kind: "legacy" }));
  const svc = (serviceEntries || []).filter(Boolean);
  const active = [
    ...svc.filter((entry) => !entry.deleted_at),
    ...legacy(legacyActive),
  ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 60);
  const deleted = [
    ...svc.filter((entry) => entry.deleted_at),
    ...legacy(legacyDeleted),
  ].sort((a, b) => String(b.deleted_at || "").localeCompare(String(a.deleted_at || ""))).slice(0, 30);
  return { active, deleted };
}
