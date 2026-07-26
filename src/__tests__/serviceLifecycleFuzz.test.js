// ── The monkey: randomized model simulation of the service-entity design ─────
//
// A faithful in-memory model of the POSTGRES-SIDE semantics this release
// ships (schema.sql + the migration):
//   • the services single-live trigger (newest started_at wins, losers end
//     non-destructively),
//   • the service-scoped save_service_table_if_current CAS,
//   • the NEUTERED legacy archive_and_finish_service (never touches rows),
//   • purge rules (only ended + already-trashed services can be deleted).
//
// Driven by a fleet of simulated devices doing everything real tablets do at
// the worst possible times: starting/ending services, writing tables, going
// offline mid-write, replaying hours-old queues on reconnect, booting with
// stale caches, running the rollover auto-end with a wrong clock, and — the
// legacy straggler — calling the old wiping RPC guarded AND unguarded.
//
// INVARIANTS asserted throughout (the properties the rework exists for):
//   I1  No operation other than an explicit board-write addressed to a
//       service's own namespace (or a double-confirmed purge) ever changes,
//       blanks or deletes that service's rows. Ends, starts, heals, legacy
//       RPCs, replays: zero table mutations, byte-for-byte.
//   I2  A row never changes which service it belongs to.
//   I3  At most one LIVE service per workspace after every operation.
//   I4  An ended service's rows still exist (unless purged) — the archive is
//       never silently emptied.
//   I5  Adoption is deterministic: every device reading the store picks the
//       same current service (currentServiceFrom).
//
// Op count is env-tunable: FUZZ_OPS=2000000 for a release-night deep soak,
// default 50k so CI stays fast. Seeded PRNG → every failure is reproducible
// from the seed printed on the first line of the run.

import { describe, it, expect } from "vitest";
import { currentServiceFrom } from "../lib/serviceEntity.js";

const OPS = Number(process.env.FUZZ_OPS || 50_000);
const SEED = Number(process.env.FUZZ_SEED || 20260722);

// Mulberry32 — small, fast, deterministic.
const makeRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe("service entity model — randomized device-fleet simulation", () => {
  it(`survives ${OPS.toLocaleString()} adversarial operations with zero data-integrity violations (seed ${SEED})`, () => {
    const rng = makeRng(SEED);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const chance = (p) => rng() < p;

    // ── the "Postgres" ──────────────────────────────────────────────────────
    const WS = "ws-milka";
    let clock = 1_000_000; // ms; monotonic server clock
    const store = {
      services: new Map(), // id → {id, date, started_at, status, ended_at, deleted_at}
      tables: new Map(),   // `${svc}|${tid}` → {svc, tid, content, updated_at}
    };

    const singleLiveTrigger = (row) => {
      if (!row || row.status !== "live") return;
      const newerLive = [...store.services.values()].some((r) =>
        r !== row && r.status === "live" && r.started_at > row.started_at);
      if (newerLive) {
        row.status = "ended"; row.ended_at = clock; row.end_reason = "superseded";
        return;
      }
      for (const r of store.services.values()) {
        if (r === row || r.status !== "live") continue;
        r.status = "ended"; r.ended_at = clock; r.end_reason = "superseded";
      }
    };

    const sqlInsertService = (svc) => {
      if (store.services.has(svc.id)) return false;
      store.services.set(svc.id, { ...svc });
      singleLiveTrigger(store.services.get(svc.id));
      return true;
    };
    const sqlUpdateService = (id, patch) => {
      const row = store.services.get(id);
      if (!row) return false;
      Object.assign(row, patch);
      singleLiveTrigger(row);
      return true;
    };
    // save_service_table_if_current — the ONLY way table rows are written.
    const sqlSaveTableCas = (svc, tid, expected, content) => {
      const key = `${svc}|${tid}`;
      const row = store.tables.get(key);
      if (expected == null) {
        if (row) return false;
        store.tables.set(key, { svc, tid, content, updated_at: ++clock });
        return true;
      }
      if (!row || row.updated_at !== expected) return false;
      row.content = content; row.updated_at = ++clock;
      return true;
    };
    // The neutered legacy RPC: guarded or not, it may NOT touch tables.
    const sqlLegacyFinish = () => { /* files an archive snapshot; nothing else */ };
    // Purge: only ended + trashed. Cascades to its rows (the one allowed delete).
    const sqlPurge = (id) => {
      const row = store.services.get(id);
      if (!row || row.status !== "ended" || row.deleted_at == null) return false;
      store.services.delete(id);
      for (const key of [...store.tables.keys()]) {
        if (store.tables.get(key).svc === id) store.tables.delete(key);
      }
      return true;
    };

    // ── the truth ledger the invariants compare against ────────────────────
    // ledger mirrors what EXPLICIT namespace-addressed writes established.
    const ledger = new Map(); // key → content
    const purged = new Set();

    const assertIntegrity = (opName) => {
      // I3: at most one live service.
      const live = [...store.services.values()].filter((r) => r.status === "live");
      if (live.length > 1) throw new Error(`[${opName}] I3 violated: ${live.length} live services`);
      // I1/I2: every row matches the ledger exactly; no extra, none missing.
      if (store.tables.size !== ledger.size) {
        throw new Error(`[${opName}] I1 violated: row count ${store.tables.size} != ledger ${ledger.size}`);
      }
      for (const [key, row] of store.tables) {
        const truth = ledger.get(key);
        if (truth === undefined) throw new Error(`[${opName}] I2 violated: unexpected row ${key}`);
        if (truth !== row.content) throw new Error(`[${opName}] I1 violated: ${key} content mutated`);
        if (`${row.svc}|${row.tid}` !== key) throw new Error(`[${opName}] I2 violated: ${key} re-keyed`);
      }
      // I4: every ended, un-purged service that ever had rows still has them.
      // (Covered by the ledger equality above — rows only leave the ledger on
      // explicit clear-table writes or purge.)
      // I5: adoption is deterministic and identical for every reader.
      const rows = [...store.services.values()].map((r) => ({
        id: r.id, date: "2026-07-23", session: "dinner",
        started_at: String(r.started_at).padStart(16, "0"), status: r.status,
      }));
      const a = currentServiceFrom(rows)?.id ?? null;
      const b = currentServiceFrom([...rows].reverse())?.id ?? null;
      if (a !== b) throw new Error(`[${opName}] I5 violated: adoption order-dependent (${a} vs ${b})`);
    };

    // ── the device fleet ────────────────────────────────────────────────────
    const DEVICES = 6;
    let nextSvc = 1;
    let today = 100; // abstract service-day counter
    const devices = Array.from({ length: DEVICES }, (_, i) => ({
      id: `dev-${i}`,
      believed: null,          // service id this device thinks is live
      seen: new Map(),         // key → updated_at it last saw (CAS ancestor)
      offline: false,
      queue: [],               // ops queued while offline, replayed in order
      clockSkewDays: 0,        // wrong-clock devices judge staleness wrongly
    }));

    const serverAdopt = () => {
      const live = [...store.services.values()]
        .filter((r) => r.status === "live")
        .sort((x, y) => (y.started_at - x.started_at) || (x.id < y.id ? 1 : -1));
      return live[0]?.id ?? null;
    };

    // A board write addressed to a NAMED namespace — the only ledger writer.
    const applyBoardWrite = (svcId, tid, content) => {
      const svc = store.services.get(svcId);
      if (!svc || purged.has(svcId)) return; // namespace gone (purged) — write dies
      const key = `${svcId}|${tid}`;
      // CAS with one reread-retry, like the real client (fold ≈ overwrite at
      // this abstraction level — content identity is what the invariant needs).
      const current = store.tables.get(key);
      if (!sqlSaveTableCas(svcId, tid, current ? current.updated_at : null, content)) {
        const again = store.tables.get(key);
        sqlSaveTableCas(svcId, tid, again ? again.updated_at : null, content);
      }
      ledger.set(key, content);
    };

    const OPS_TABLE = [
      ["startService", 8, (d) => {
        const id = `svc-${nextSvc++}`;
        const op = () => {
          sqlInsertService({ id, date: today, started_at: ++clock, status: "live", ended_at: null, deleted_at: null, end_reason: null });
          // adopt the store's verdict, not our own assumption
          d.believed = serverAdopt();
        };
        if (d.offline) { const started = ++clock; d.queue.push(() => { sqlInsertService({ id, date: today, started_at: started, status: "live", ended_at: null, deleted_at: null, end_reason: null }); }); d.believed = id; }
        else op();
      }],
      ["boardWrite", 30, (d) => {
        if (!d.believed) return;
        const svcId = d.believed;
        const tid = 1 + Math.floor(rng() * 10);
        const content = `c${Math.floor(rng() * 1e9)}`;
        if (d.offline) d.queue.push(() => applyBoardWrite(svcId, tid, content));
        else applyBoardWrite(svcId, tid, content);
      }],
      ["clearTable", 4, (d) => {
        // Explicit CLEAR TABLE: an allowed, namespace-addressed destruction.
        if (!d.believed) return;
        const svcId = d.believed;
        const tid = 1 + Math.floor(rng() * 10);
        const op = () => {
          if (!store.tables.has(`${svcId}|${tid}`)) return;
          applyBoardWrite(svcId, tid, "");
        };
        if (d.offline) d.queue.push(op); else op();
      }],
      ["endBelieved", 8, (d) => {
        // END SERVICE — possibly hours-stale (the 22.07 replay shape).
        if (!d.believed) return;
        const svcId = d.believed;
        const op = () => { sqlUpdateService(svcId, { status: "ended", ended_at: ++clock, end_reason: "manual" }); };
        if (d.offline) d.queue.push(op); else { op(); d.believed = null; }
      }],
      ["autoEndStale", 6, (d) => {
        // Rollover auto-end, judged on a possibly SKEWED clock: the device may
        // wrongly conclude the live service is stale. The design's promise is
        // that even the WRONG verdict destroys nothing.
        const target = d.believed || serverAdopt();
        if (!target) return;
        const svc = store.services.get(target);
        if (!svc) return;
        const deviceToday = today + d.clockSkewDays;
        if (svc.date < deviceToday) {
          const op = () => { sqlUpdateService(target, { status: "ended", ended_at: ++clock, end_reason: "rollover" }); };
          if (d.offline) d.queue.push(op); else op();
        }
      }],
      ["legacyStragglerRPC", 5, () => {
        // An un-updated build replays its queued END through the old RPC —
        // guarded or unguarded. It must never touch a row.
        sqlLegacyFinish();
      }],
      ["adopt", 12, (d) => { if (!d.offline) d.believed = serverAdopt(); }],
      ["bootWithStaleCache", 5, (d) => {
        // Reload: localStorage may hold ANY historical service id.
        const all = [...store.services.keys()];
        d.believed = all.length && chance(0.5) ? pick(all) : serverAdopt();
        d.seen.clear();
        if (!d.offline) d.believed = serverAdopt(); // boot check adopts the store
      }],
      ["goOffline", 5, (d) => { d.offline = true; }],
      ["reconnect", 8, (d) => {
        // Drain the queue IN ORDER (PowerSync upload semantics), then adopt.
        d.offline = false;
        const q = d.queue; d.queue = [];
        for (const op of q) op();
        d.believed = serverAdopt();
      }],
      ["archiveTrash", 3, () => {
        const ended = [...store.services.values()].filter((r) => r.status === "ended" && r.deleted_at == null);
        if (ended.length) pick(ended).deleted_at = ++clock;
      }],
      ["purgeTrash", 2, () => {
        const trashed = [...store.services.values()].filter((r) => r.status === "ended" && r.deleted_at != null);
        if (!trashed.length) return;
        const victim = pick(trashed);
        if (sqlPurge(victim.id)) {
          purged.add(victim.id);
          for (const key of [...ledger.keys()]) {
            if (key.startsWith(`${victim.id}|`)) ledger.delete(key);
          }
        }
      }],
      ["dayRollover", 2, () => { today += 1; }],
      ["skewClock", 2, (d) => { d.clockSkewDays = pick([-1, 0, 0, 0, 1, 2]); }],
    ];
    const weighted = OPS_TABLE.flatMap(([name, w, fn]) => Array.from({ length: w }, () => [name, fn]));

    // ── run ─────────────────────────────────────────────────────────────────
    let violations = 0;
    for (let i = 0; i < OPS; i += 1) {
      const d = pick(devices);
      const [name, fn] = pick(weighted);
      try {
        fn(d);
        assertIntegrity(name);
      } catch (error) {
        violations += 1;
        // Fail loudly with full reproduction context.
        throw new Error(`op #${i} (${name}, ${d.id}, seed ${SEED}): ${error.message}`);
      }
      // Retention so multi-million-op soaks stay fast: hard-purge the oldest
      // long-ended trashed services once the model grows big. Uses the same
      // legal purge path, so it exercises I4's boundary constantly.
      if (store.services.size > 400) {
        const oldEnded = [...store.services.values()]
          .filter((r) => r.status === "ended")
          .sort((a, b) => a.ended_at - b.ended_at)
          .slice(0, 100);
        for (const r of oldEnded) {
          r.deleted_at = r.deleted_at ?? ++clock;
          if (sqlPurge(r.id)) {
            purged.add(r.id);
            for (const key of [...ledger.keys()]) {
              if (key.startsWith(`${r.id}|`)) ledger.delete(key);
            }
          }
        }
        assertIntegrity("retention-purge");
      }
    }

    expect(violations).toBe(0);
  }, 30 * 60 * 1000);
});
