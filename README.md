# Service Board

## Service lifecycle (entity model)
Every service is a row in the `services` table. STARTing inserts a new row (a
fresh board namespace — clears nothing); ENDing flips that one row to
`ended` (destroys nothing — the ended service and its `service_tables` rows
ARE the archive entry). A stale/offline device can only ever end the old
service it knows about, so the historical "board wiped mid-service" incident
class is structurally impossible. See `docs/SERVICE_ENTITY_RELEASE.md` for
the model, the migration, and the release-night runbook.

## Multi-restaurant (workspaces) + login
The app now requires a Supabase **email + password login**, and all data is
isolated per **restaurant (workspace)**:

- **Restaurant logins** only ever see their own restaurant's data.
- **Demo is a normal sandbox restaurant** owned by a separate test login. It
  uses the same PowerSync, RLS and UI path as Milka, with fake data isolated by
  a different `workspace_id`.
- There is no master account or cross-restaurant authorization bypass. A
  generic picker remains only for a login deliberately linked to multiple
  workspaces later; normal Milka and Demo logins skip it.

Every data table carries a `workspace_id`; the `scopedFrom()` helper
(`src/lib/scopedDb.js`) scopes all reads/writes, realtime is filtered per
workspace, and the offline write-queue stamps the workspace at enqueue time.

## Required Supabase setup
1. For a new project, run `schema.sql`. For an existing deployment, apply the
   files in `supabase/migrations/` in filename order before deploying the app.
2. Put your Supabase URL and anon key into `.env` (see `env.example`).
3. For a controlled new restaurant, preview and then apply the idempotent
   operator workflow (server-only service key; dry-run is the default):

   ```sh
   npm run onboard:restaurant -- --name "Restaurant Name" --admin-email admin@example.com
   npm run onboard:restaurant -- --name "Restaurant Name" --admin-email admin@example.com --apply
   ```

   Existing Milka and Demo users remain linked to their intended workspaces.
4. Deploy `powersync/sync-rules.yaml` to the PowerSync instance. The app and
   these rules must ship together because local ids are workspace-qualified.
5. Start the app with `npm install` and `npm run dev`.

Before deployment, verify which account is linked to which workspace:

```sql
select w.slug, u.email, m.role, m.user_id
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
join auth.users u on u.id = m.user_id
order by w.slug, m.role, u.email;
```

Each slug should show only its intended login. The `admin`, `service`, and
`kitchen` roles are enforced in Postgres RLS; `supabase test db` runs the
executable role and cross-tenant contract in `supabase/tests/`.

## Live-service data path

- A tap writes to the tablet's local PowerSync SQLite database first, so the UI
  responds immediately and continues working without Wi-Fi.
- PowerSync uploads the queued change to Supabase and streams it to the other
  signed-in tablets; no refresh is required.
- Direct Supabase realtime is retained only as an outage/disabled fallback.
- Supabase/API responses are never service-worker cached as live data.

Run `npm run check` before deployment. It executes the complete unit/integration
suite and a production build. GitHub Actions runs the same command.

Do not onboard an external restaurant from code-readiness alone. Use
`docs/PILOT_ROLLOUT.md` for the restore, real-Postgres RLS, hardware, privacy,
and deployment-order gates.

## Notes
- Menu courses are edited and saved directly via Admin > Menu Layout.
- Wines and beverages are restaurant-owned and manually editable. Milka's
  external source remains an optional configured integration; new workspaces
  start with automated catalogue sync disabled.
- Drinks (cocktails, spirits, beers) can also be edited manually in Admin > Drinks.
- The old shared-password gate (`VITE_ACCESS_PASSWORD`) is now only used in
  local-only mode (when Supabase isn't configured).
