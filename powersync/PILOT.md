# PowerSync deployment notes

The old Demo-only pilot is complete. PowerSync is now the primary live/offline
path for every explicit restaurant membership, including the separate Demo
test account.

## 1. Database prerequisite

Apply every file in `supabase/migrations/` in filename order. Do not manually
create or maintain the publication from a dashboard-only SQL snippet. The
`20260710010000_powersync_publication_and_role_preflight.sql` migration creates
the `powersync` publication when needed and idempotently includes:

- `workspace_members`
- `service_tables`
- `reservations`
- `service_settings`
- `menu_courses`
- `beverages`
- `wines`
- `service_archive`

`workspace_members` is required because the sync streams use the authenticated
user id to select authorized workspace ids.

## 2. PowerSync instance

1. Connect the instance to the Supabase Postgres database using the direct or
   session connection and publication name `powersync`.
2. Configure Supabase JWT validation for the instance.
3. Deploy `powersync/sync-rules.yaml`.
4. Run Sync Test as a restaurant member and verify it receives only its
   authorized workspace rows. Also test a user belonging to two workspaces;
   both sets may coexist because local ids are workspace-qualified.
5. Put the instance URL in the web deployment as `VITE_POWERSYNC_URL`.

## 3. Release verification

Run `npm run check`, then complete every drill in `docs/SERVICE_DRILLS.md` on
the Demo workspace with two real devices. The release is not ready for live
service until button taps propagate without refresh, offline edits converge on
reconnect, and Archive & Clear arrives as one lifecycle transition.

Never deploy changed sync rules, database migrations, or the web client as
uncoordinated releases. Follow the exact order in `REWORK_NOTES.md`.
