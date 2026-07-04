// Shared service_archive store seam for the archive surfaces (ArchiveModal,
// admin ArchivePanel, GuestMemory): reads and mutations go to the on-device
// SQLite DB when it is primary (instant, works offline; uploads ride the
// connector queue) and fall back to direct Supabase calls otherwise.

import { getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";

// → { active, deleted } — active newest-first ≤60, trash newest-first ≤30
// (the shapes the modal always consumed). Throws on a failed fallback read.
export async function fetchArchive() {
  if (isSqlitePrimary()) {
    const { readServiceArchive } = await import("../powersync/reads.js");
    return readServiceArchive();
  }
  const [active, trash] = await Promise.all([
    scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
    scopedFrom(TABLES.SERVICE_ARCHIVE).select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
  ]);
  if (active.error) throw active.error;
  return { active: active.data || [], deleted: trash.error ? [] : (trash.data || []) };
}

const attempt = async (run) => {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

// Soft-delete / restore one entry (deletedAt ISO string, or null to restore).
export function archiveSetDeleted(id, deletedAt) {
  return attempt(async () => {
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

// Soft-delete every active entry.
export function archiveSetAllDeleted(deletedAt) {
  return attempt(async () => {
    if (isSqlitePrimary()) {
      const { setAllArchivesDeleted } = await import("../powersync/writes.js");
      await setAllArchivesDeleted(deletedAt);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .update({ deleted_at: deletedAt }).is("deleted_at", null);
      if (error) throw error;
    }
  });
}

// Permanently purge the trash.
export function archivePurgeTrash() {
  return attempt(async () => {
    if (isSqlitePrimary()) {
      const { purgeDeletedArchives } = await import("../powersync/writes.js");
      await purgeDeletedArchives();
    } else {
      const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .delete().not("deleted_at", "is", null);
      if (error) throw error;
    }
  });
}

export { getWorkspaceId };
