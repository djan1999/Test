# Rework handoff

## What changed

The live service path is now local-first:

1. A service or kitchen tap writes to the tablet's PowerSync SQLite database.
2. The screen updates immediately, including when Wi-Fi is weak or offline.
3. PowerSync uploads the queued change and streams it to the other tablets.
4. Supabase remains the authenticated server/database. Its direct realtime
   channel is an outage/disabled fallback, not a special-account pathway and
   not active in parallel with PowerSync on normal tablets.

Important fixes include workspace-safe local ids and browser caches,
compare-and-swap board merging for different-seat edits, atomic service ending,
atomic reservation
swaps, per-device inventory rows, atomic catalog replacement, removal of the
browser-exposed sync secret, membership-based authorization, and removal of
stale API caching from the service worker.

## Deployment order (mandatory)

Do these in one controlled release, preferably after service hours:

1. Back up the Supabase database.
2. Create/use separate Supabase Auth logins for Milka and Demo. Verify each is
   linked only to its own `workspace_members` row. All current members have
   full restaurant owner/admin access; roles are deferred until later.
3. Apply every file in `supabase/migrations/` in filename order. The publication
   migration reconstructs PowerSync's source list; the final account migration
   removes the old cross-restaurant pathway.
4. Deploy `powersync/sync-rules.yaml` in the PowerSync dashboard and validate it
   with Sync Test for a restaurant member.
5. Confirm the deployment environment from `env.example`. In particular:
   `VITE_POWERSYNC_URL`, Supabase URL/public key, server-only Supabase secret
   key, and server-only `CRON_SECRET`.
6. Deploy the web app. Do not deploy the client before the database and sync
   rule steps.
7. Open two tablets in the Demo workspace and run the drills in
   `docs/SERVICE_DRILLS.md`: tap service → kitchen, kitchen → service, offline
   edits → reconnect, and archive/end service.

The local database filename was bumped to v2, so installed tablets rebuild the
corrected local database automatically after the new app loads.

## Verification completed

- `npm run check`: 735 tests passed and the production PWA build completed.
- Production dependency audit: zero known vulnerabilities.
- The generated bundle contains no browser sync secret and the service worker
  contains no Supabase/API response cache.
- CI now runs the same test/build gate for every push and pull request.

Visual browser automation was unavailable in this restricted workspace. The
two-tablet Demo drills are therefore a mandatory release step, not optional
paperwork; they verify the real Supabase, PowerSync and tablet environment.

No software can honestly be guaranteed flawless. The remaining deliberate
conflict rule is: if two people edit the exact same seat at the same time, the
last committed edit wins. Different-seat edits are merged and preserved.
