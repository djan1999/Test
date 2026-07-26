// Shared archive store seam for the archive surfaces (ArchiveModal, admin
// ArchivePanel, GuestMemory): reads and mutations go to the on-device SQLite
// DB when it is primary (instant, works offline; uploads ride the connector
// queue) and fall back to direct Supabase calls otherwise.
//
// Since the service-entity rework the archive is TWO sources merged into one
// view: ENDED SERVICES (the service row + its still-live table rows, adapted
// to the legacy entry shape) and legacy `service_archive` snapshots. Entries
// carry `_kind` ("service" | "legacy"); mutations that only get an id resolve
// the backing table with a probe (PowerSync view writes report rowsAffected 0,
// so a probe-then-write is the only reliable shape on both paths).

import { getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";
import { isSandbox } from "./sandbox.js";
import { archiveEntryFromService, mergeArchiveEntries } from "./serviceEntity.js";

// → { active, deleted } — active newest-first ≤60, trash newest-first ≤30
// (the shapes the modal always consumed). Throws on a failed fallback read.
export async function fetchArchive() {
  if (isSqlitePrimary()) {
    const { readServiceArchive } = await import("../powersync/reads.js");
    return readServiceArchive();
  }
  const [active, trash, ended] = await Promise.all([
    scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
    scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    scopedFrom(TABLES.SERVICES).select("*").eq("status", "ended").order("ended_at", { ascending: false }).limit(90),
  ]);
  if (active.error) throw active.error;
  const services = ended.error ? [] : (ended.data || []);
  let rowsByService = new Map();
  if (services.length > 0) {
    const { data: tableRows } = await scopedFrom(TABLES.SERVICE_TABLES)
      .select("service_id, table_id, data, updated_at")
      .in("service_id", services.map((row) => row.id));
    rowsByService = new Map();
    for (const row of tableRows || []) {
      const key = String(row.service_id);
      if (!rowsByService.has(key)) rowsByService.set(key, []);
      rowsByService.get(key).push(row);
    }
  }
  return mergeArchiveEntries({
    serviceEntries: services.map((row) => archiveEntryFromService(row, rowsByService.get(String(row.id)) || [])),
    legacyActive: active.data || [],
    legacyDeleted: trash.error ? [] : (trash.data || []),
  });
}

const attempt = async (run) => {
  // Test service: archive edits (delete / restore / purge) must never touch
  // the real archive — report success and change nothing.
  if (isSandbox()) return { ok: true };
  try {
    await run();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

// Does this id belong to an (ended) service entry rather than a legacy
// archive row? Probe-then-write: rowsAffected through the PowerSync views is
// not trustworthy, and PostgREST updates don't report match counts.
async function isServiceEntry(id) {
  if (isSqlitePrimary()) {
    const { getPowerSync } = await import("../powersync/system.js");
    const row = await getPowerSync().getOptional(
      "SELECT id FROM services WHERE id = ? AND workspace_id = ?",
      [String(id), getWorkspaceId()],
    );
    return Boolean(row);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICES)
    .select("id").eq("id", id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// Soft-delete / restore one entry (deletedAt ISO string, or null to restore).
// Works for both kinds; a service entry's table rows are untouched either way.
export function archiveSetDeleted(id, deletedAt) {
  return attempt(async () => {
    if (await isServiceEntry(id)) {
      if (isSqlitePrimary()) {
        const { setServiceDeleted } = await import("../powersync/writes.js");
        await setServiceDeleted(id, deletedAt);
      } else {
        const { error } = await scopedFrom(TABLES.SERVICES)
          .update({ deleted_at: deletedAt, updated_at: new Date().toISOString() })
          .eq("id", id).eq("status", "ended");
        if (error) throw error;
      }
      return;
    }
    if (isSqlitePrimary()) {
      const { setArchiveDeleted } = await import("../powersync/writes.js");
      await setArchiveDeleted(id, deletedAt);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .update({ deleted_at: deletedAt }).eq("id", id);
      if (error) throw error;
    }
  });
}

// Soft-delete every active entry (both kinds). LIVE services are never
// touched — only ended ones are archive entries at all.
export function archiveSetAllDeleted(deletedAt) {
  return attempt(async () => {
    if (isSqlitePrimary()) {
      const { setAllArchivesDeleted } = await import("../powersync/writes.js");
      await setAllArchivesDeleted(deletedAt);
      const { getPowerSync } = await import("../powersync/system.js");
      await getPowerSync().execute(
        "UPDATE services SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND status = 'ended' AND deleted_at IS NULL",
        [deletedAt, new Date().toISOString(), getWorkspaceId()],
      );
    } else {
      const legacy = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .update({ deleted_at: deletedAt }).is("deleted_at", null);
      if (legacy.error) throw legacy.error;
      const services = await scopedFrom(TABLES.SERVICES)
        .update({ deleted_at: deletedAt, updated_at: new Date().toISOString() })
        .eq("status", "ended").is("deleted_at", null);
      if (services.error) throw services.error;
    }
  });
}

// Permanently purge everything in the archive trash. For service entries this
// hard-deletes the ENDED, already soft-deleted service and (via FK cascade /
// the explicit local delete) its table rows — the double-confirmed except.
// The server's RLS delete policy refuses anything live or not yet trashed.
export function archivePurgeTrash() {
  return attempt(async () => {
    if (isSqlitePrimary()) {
      const { purgeDeletedArchives, purgeDeletedServices } = await import("../powersync/writes.js");
      await purgeDeletedArchives();
      await purgeDeletedServices();
    } else {
      const legacy = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .delete().not("deleted_at", "is", null);
      if (legacy.error) throw legacy.error;
      const services = await scopedFrom(TABLES.SERVICES)
        .delete().eq("status", "ended").not("deleted_at", "is", null);
      if (services.error) throw services.error;
    }
  });
}

export { getWorkspaceId };
