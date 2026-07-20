// ── Seam discipline: every direct DB call site is consciously allowed ────────
//
// All reads and writes of workspace data must go through a store seam
// (lib/stateStore, lib/archiveStore, App's persistBoardRows /
// persistReservationRow / persistServiceEnd / fetchBoardRows, or
// powersync/writes|reads) so that SQLite-primary devices read and write the
// same store the watches re-read from. A `scopedFrom(...)` or
// `supabase.from(...)` call anywhere else is a silent seam bypass: on the
// SQLite-primary path the next watch tick re-reads the local DB and REVERTS
// the write. That exact miss — a direct RESERVATIONS.update inside
// onMoveTable — caused the 04.07 "guest on two tables, other guest hidden"
// production incident (PR #44).
//
// This test statically scans src/ (tests excluded) for both call shapes and
// compares them against the curated allowlist below, in BOTH directions:
//   - a call site not in the allowlist fails: route it through a seam, or —
//     only if it genuinely must bypass (fallback branch of a seam, auth
//     bootstrap on non-workspace tables) — add it here, consciously.
//   - a stale allowlist entry also fails, so the list always mirrors reality.
//
// Counts are per (file, table, method). Moving a call between files or adding
// a second call of an allowed shape still trips the test — that is the point:
// every change to the set of direct call sites is an explicit review decision.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every direct call site that is ALLOWED to exist, keyed by file, then by
// "<table-arg>.<method>" for scopedFrom chains or "supabase.from" for raw
// client calls, with the exact expected count. Each entry says WHY it may
// bypass the seams.
const ALLOWLIST = {
  "App.jsx": {
    // Direct-Supabase fallback branches of the store seams and one-shot
    // loaders. They run only when sqlitePrimary is false (PowerSync unavailable
    // or disabled), so the watches never fight them.
    "TABLES.SERVICE_TABLES.select": 2,   // fetchBoardRows fallback + board poll
    "TABLES.RESERVATIONS.upsert": 1,     // atomic multi-reservation swap fallback
    "TABLES.RESERVATIONS.insert": 1,     // saveRes create (id comes from DB)
    "TABLES.RESERVATIONS.delete": 1,     // deleteReservation fallback
    "TABLES.RESERVATIONS.select": 1,     // fallback one-shot load
    "TABLES.SERVICE_ARCHIVE.select": 2,  // fallback archive list + dedup check
    "TABLES.MENU_COURSES.select": 1,     // fetchMenuCourses (admin surface)
    "TABLES.MENU_COURSES.upsert": 2,     // saveMenuCourses + legacy-shape retry
    "TABLES.MENU_COURSES.delete": 1,     // saveMenuCourses prune
    "TABLES.WINES.select": 1,            // fallback one-shot load
    "TABLES.WINES.upsert": 1,            // wine sync batch write
    "TABLES.WINES.delete": 1,            // wine sync prune
    "TABLES.BEVERAGES.select": 1,        // fallback one-shot load
    "TABLES.BEVERAGES.insert": 1,        // beverage sync write
    "TABLES.BEVERAGES.delete": 1,        // beverage sync prune
  },
  "components/reservations/GuestMemory.jsx": {
    "TABLES.SERVICE_ARCHIVE.select": 1,  // fallback read when SQLite not primary
  },
  "lib/archiveStore.js": {
    // IS the archive seam — its fallback branch talks to Supabase directly.
    "TABLES.SERVICE_ARCHIVE.select": 2,
    "TABLES.SERVICE_ARCHIVE.update": 2,
    "TABLES.SERVICE_ARCHIVE.delete": 1,
  },
  "lib/auditStore.js": {
    // Audit history stays on the server and is not synchronized into each
    // operational tablet's local PowerSync database.
    "TABLES.AUDIT_LOG.select": 1,
  },
  "lib/stateStore.js": {
    // IS the service_settings seam — same deal.
    "TABLES.SERVICE_SETTINGS.select": 2, // exact-key and prefix reads
    "TABLES.SERVICE_SETTINGS, workspaceId.upsert": 1, // retained retry pinned to its original workspace
  },
  "lib/scopedDb.js": {
    "supabase.from": 1,                  // the scopedFrom wrapper itself
  },
  "powersync/SupabaseConnector.js": {
    "supabase.from": 1,                  // uploadData IS the upload seam
  },
  "hooks/useWorkspaceAccess.js": {
    // Auth bootstrap runs before an active workspace exists: workspace list,
    // own roles, and a live own-role refresh.
    "supabase.from": 3,
  },
};

const listSourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : listSourceFiles(p);
    return /\.(js|jsx)$/.test(entry.name) ? [p] : [];
  });

// Strip comments so prose mentions of scopedFrom(...)/supabase.from(...) don't
// count as call sites. `//` is treated as a comment only at start-of-line or
// after whitespace, which protects `https://…` inside string literals.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");

const scanCallSites = () => {
  const found = {};
  for (const file of listSourceFiles(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, file).split(path.sep).join("/");
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const add = (key) => {
      found[rel] = found[rel] || {};
      found[rel][key] = (found[rel][key] || 0) + 1;
    };
    // scopedFrom(<table>).<method>( — the chained method may sit on the next
    // line, so the regex spans newlines.
    for (const m of code.matchAll(/scopedFrom\(\s*([^)]+?)\s*\)\s*\.\s*(\w+)\s*\(/g)) {
      add(`${m[1]}.${m[2]}`);
    }
    for (const _ of code.matchAll(/\bsupabase\s*\.\s*from\s*\(/g)) {
      add("supabase.from");
    }
  }
  return found;
};

const GUIDANCE =
  "Direct DB calls bypass the store seams. On SQLite-primary devices the " +
  "watches re-read the local DB and REVERT a direct Supabase write on the " +
  "next tick (the PR #44 table-switch duplication bug). Route the call " +
  "through a seam instead: lib/stateStore (readStateKey/saveStateKey), " +
  "lib/archiveStore, App's persistBoardRows / persistReservationRow / " +
  "persistServiceEnd / fetchBoardRows, or powersync/writes|reads. Only if " +
  "this call genuinely must go direct (a seam's own fallback branch, auth " +
  "bootstrap on non-workspace tables), consciously update the allowlist in " +
  "src/__tests__/seamDiscipline.test.js with a comment saying why.";

describe("seam discipline: direct DB call sites", () => {
  const found = scanCallSites();

  it("has no direct scopedFrom/supabase.from call outside the allowlist", () => {
    const violations = [];
    for (const [file, calls] of Object.entries(found)) {
      for (const [key, count] of Object.entries(calls)) {
        const allowed = ALLOWLIST[file]?.[key] || 0;
        if (count > allowed) {
          violations.push(`  ${file}: ${key} — found ${count}, allowed ${allowed}`);
        }
      }
    }
    expect(
      violations.length,
      `New direct DB call site(s):\n${violations.join("\n")}\n\n${GUIDANCE}`,
    ).toBe(0);
  });

  it("has no stale allowlist entry (list mirrors reality)", () => {
    const stale = [];
    for (const [file, calls] of Object.entries(ALLOWLIST)) {
      for (const [key, allowed] of Object.entries(calls)) {
        const count = found[file]?.[key] || 0;
        if (count < allowed) {
          stale.push(`  ${file}: ${key} — allowlist says ${allowed}, found ${count}`);
        }
      }
    }
    expect(
      stale.length,
      `Allowlist entries no longer matching any call site (remove or fix them ` +
      `in src/__tests__/seamDiscipline.test.js):\n${stale.join("\n")}`,
    ).toBe(0);
  });
});
