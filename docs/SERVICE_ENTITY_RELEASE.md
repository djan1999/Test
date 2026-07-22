# Service Entity Lifecycle — release runbook

**What this release is:** the complete rework of how services start and end,
built after the 22.07 incident (the fourth mid-service board wipe). It makes
the wipe class **structurally impossible** instead of guarded-against.

## The model change in one paragraph

Every service is now its own row in a new `services` table. **START** inserts
a new row — a fresh board namespace; nothing is cleared, because the new
service simply has no table rows yet. **END** flips that one row to
`status='ended'` — idempotent, one field; nothing is copied and nothing is
blanked, because the ended service (with every one of its `service_tables`
rows, now keyed by `service_id`) **is** the archive entry. A stale or offline
device replaying an END can only flip the old row it knows about — a no-op —
and has no way to address a newer service's data. The operation "blank the
board" no longer exists anywhere in the system: not in the app, not in the
database functions.

What died with the old model: `archive_and_finish_service`'s unconditional
`service_tables` blank (now a neutered stub), `finishServiceLocally`, the
connector's finish-transaction collapse, `healOrphanedService` (orphan boards
cannot exist), the day-switch board clear, the shared `service_date` settings
pointer, and the whole expected-identity guard machinery (nothing left to
guard). Floor SET strips moved to per-service keys
(`floor_status_v2:<serviceId>`), so a stale device's strip replay can never
touch a later service either.

## Why each past incident can no longer happen

| Incident | Old cause | Now |
|---|---|---|
| 22.07 (this one) | Boot-time auto-end with blind content filters → unarchived RPC wipe | Auto-end is a status flip; the rows stay; the live-guard uses the full `tableHasServiceContent` definition and reads the judged service's own rows |
| Offline END replay (11.07 class, analysis S1/ARCHIVE-1) | Queued finish replayed as an unguarded blanking RPC | Replays as `UPDATE services SET status='ended' WHERE id=<old uuid>` — touches only the old service |
| 04.07 (live dinner auto-ended) | Stale-date auto-end archived+cleared a live board | Wrong verdicts are recoverable: the service parks intact in the Archive |
| 19.06 (orphaned board never filed) | Board rows had no service identity | Rows always belong to a service; orphans cannot exist |
| 10.06 (double-file), swallowed archives | `on conflict do nothing` on deterministic archive ids | No archive copy step exists; ending twice is idempotent |
| "Opened the laptop, wiped the tablet" | Join path cleared the shared rows | Joining is reading the live `services` row; adopters never write |

## Release night — do these IN ORDER, after service, all tablets present

1. **Back up the Supabase database** (dashboard → Database → Backups, or
   `pg_dump`). Non-negotiable.
2. **Apply the migration**: `supabase/migrations/20260722230000_service_entity_lifecycle.sql`
   (via `supabase db push` or the SQL editor). It:
   - creates `services` (+ RLS, + the single-live trigger — newest
     `started_at` wins, losers are ended *non-destructively*);
   - backfills: the current live board becomes a real `services` row (from
     the old `service_date` state), orphaned contentful boards become a
     `recovered` ended service, placeholder blank rows are dropped;
   - re-keys `service_tables` to `(workspace_id, service_id, table_id)`;
   - replaces `save_service_table_if_current` (new `p_service_id` arg; the
     old signature now fails loudly);
   - **neuters `archive_and_finish_service`** — the straggler shield: an old
     build's queued END can still file its archive snapshot but can never
     blank anything again.
3. **Deploy `powersync/sync-rules.yaml`** in the PowerSync dashboard (adds the
   `services` stream; board rows aliased `workspace|service|table`). Validate
   with Sync Test for a restaurant member.
4. **Deploy the web app build** (this branch). The local DB filename is
   bumped to `milka-powersync-v3.db`, so every tablet rebuilds its local
   database — which also discards any pre-entity queued finish transactions.
5. **Hard-refresh EVERY device** (and reinstall the PWA if pinned): every
   tablet, phone and laptop must run the new build. The old build cannot
   write board rows anymore (step 2 made that loud, not silent) — a device
   showing a persistent sync-error chip after tonight is a device still on
   the old build.
6. **Drill in the Demo workspace** (two devices):
   - start a service on device A → device B joins with no prompt, no wipe;
   - enter table content on both; end the service on A → B releases, the
     Archive shows the night with every table;
   - RESUME check: the ended entry's rows are still visible in the Archive
     detail;
   - start the next service → previous one supersedes to the Archive with
     rows intact;
   - offline drill: disconnect B, end on A, start a new service on A,
     reconnect B → B's late writes land only under the OLD service; the new
     service is untouched.

## Operational notes for staff

- **END SERVICE is now safe and cheap.** It deletes nothing — the night moves
  whole into the Archive. End lunch when lunch is done, end dinner when
  dinner is done. (The daily stale-date landmine existed only because
  services were never ended.)
- Forgetting to end is also fine: the rollover auto-end files the service at
  06:00, intact. If it ever mislabels a live service, the data is in the
  Archive, not gone.
- The Archive's trash purge is the ONLY destructive operation left, and it
  requires the entry to be ended *and* already in the trash (enforced by the
  database, not just the UI).

## What to watch the first week

- A tablet showing a persistent ERROR chip = old build (see step 5).
- The legacy `service_date` settings row is no longer read or written by the
  new build; old archives in `service_archive` remain visible (merged into
  the Archive view). Do not delete either.
- `service_tables` grows by ~10 rows per service now (rows are kept, not
  reused). At restaurant scale this is a few MB per year; a retention pass
  (compacting old services) is a later, optional optimization.
