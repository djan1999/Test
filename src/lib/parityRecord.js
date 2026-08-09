// THE PARITY RECORD — the Phase-4 flip's evidence, collecting itself
// (docs/EVENT_LOG_PLAN.md). Every time a service ends, the ending device
// drains its fact queue, folds the night's whole log with the production
// reducer, compares it against the final board, and files the verdict in the
// service_settings store. Three consecutive green nights is the Phase-3 exit
// criterion — nobody has to remember to press CHECK PARITY for the evidence
// to exist.
//
// Fire-and-forget by contract: this module can never affect ending a
// service. Every failure path returns null; nothing here throws.

import { readStateKey, saveStateKey } from "./stateStore.js";
import { drainServiceEvents, readAllServiceEvents } from "./eventLog.js";
import { foldServiceEvents, compareFoldToBoard } from "../utils/eventFold.js";
import { recordClientDiagnostic } from "./clientDiagnostics.js";

export const PARITY_RECORD_KEY = "logbook_parity_record";
const RECORD_CAP = 24; // a month of nights — enough evidence, bounded blob

// → newest-first list of end-of-night verdicts; [] when unreadable (boot,
// no workspace, storage failure — the panel just shows nothing).
export async function readParityRecord() {
  try {
    const stored = await readStateKey(PARITY_RECORD_KEY);
    return Array.isArray(stored?.entries) ? stored.entries : [];
  } catch {
    return [];
  }
}

/**
 * File one already-measured verdict into the record (newest first, capped).
 * Shared by the end-of-service recorder below and the mid-service watchdog —
 * whatever was measured is exactly what lands. Never throws; null on failure.
 */
export async function fileParityVerdict({ serviceId, label = "", reason = "manual", events = 0, compared = 0, matches = 0, divergentTables = [] }) {
  if (!serviceId) return null;
  try {
    const entry = {
      serviceId: String(serviceId),
      label: String(label || ""),
      reason,
      endedAt: new Date().toISOString(),
      events,
      compared,
      matches,
      divergentTables,
    };
    const record = await readParityRecord();
    const result = await saveStateKey(PARITY_RECORD_KEY, {
      entries: [entry, ...record].slice(0, RECORD_CAP),
    });
    return result?.ok === false ? null : entry;
  } catch {
    return null;
  }
}

/**
 * Fold the ended service's log against its final board and file the verdict.
 * `cards` is the board snapshot captured by the end path BEFORE local release
 * (already sanitized). Returns the recorded entry, or null when there was
 * nothing to record or anything failed.
 */
export async function recordEndOfServiceParity({ serviceId, label = "", reason = "manual", cards = [] }) {
  if (!serviceId) return null;
  try {
    // Flush THIS device's queued facts first so the fold sees them. Other
    // devices' queues can still lag — a red entry here says "investigate",
    // not "data lost" (the facts land when those devices drain).
    await drainServiceEvents().catch(() => {});
    const events = await readAllServiceEvents(serviceId);
    const { compared, matches, divergent } = compareFoldToBoard(foldServiceEvents(events), cards);
    if (divergent.length > 0) {
      recordClientDiagnostic("logbook parity divergence (end of night)", new Error(
        `service ${serviceId} tables ${divergent.map((d) => d.tableId).join(", ")}: `
        + JSON.stringify(divergent).slice(0, 2000),
      ));
    }
    return await fileParityVerdict({
      serviceId, label, reason,
      events: events.length, compared, matches,
      divergentTables: divergent.map((d) => d.tableId),
    });
  } catch {
    return null; // the record must never affect ending a service
  }
}
