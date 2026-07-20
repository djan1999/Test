# Milka Service Board

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

New restaurants can be prepared through the separately gated managed
onboarding path documented in `docs/MANAGED_ONBOARDING.md`. Platform access is
a server-side UUID allowlist, and optional operator access to a restaurant is
still an explicit `workspace_members` row subject to normal tenant RLS.

Every data table carries a `workspace_id`; the `scopedFrom()` helper
(`src/lib/scopedDb.js`) scopes all reads/writes, realtime is filtered per
workspace, and the offline write-queue stamps the workspace at enqueue time.

## Required Supabase setup
1. For a new project, run `schema.sql`. For an existing deployment, apply the
   files in `supabase/migrations/` in filename order before deploying the app.
2. Put your Supabase URL and anon key into `.env` (see `env.example`).
3. Create separate users in **Authentication → Users**, then link each one to
   exactly one workspace with a `workspace_members` row:
   - the Milka login → Milka;
   - the Demo test login → the Demo sandbox.
4. Deploy `powersync/sync-rules.yaml` to the PowerSync instance. The app and
   these rules must ship together because local ids are workspace-qualified.
5. Start the app with `npm install` and `npm run dev`.

Before deployment, verify which account is linked to which workspace:

```sql
select w.slug, u.email, m.user_id
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
join auth.users u on u.id = m.user_id
where w.slug in ('milka', 'demo')
order by w.slug, u.email;
```

Each slug should show only its intended login. The `role` column is retained
for future role work but is not enforced during polishing: every explicit
workspace member currently has full restaurant owner/admin access.

## Live-service data path

- A tap writes to the tablet's local PowerSync SQLite database first, so the UI
  responds immediately and continues working without Wi-Fi.
- PowerSync uploads the queued change to Supabase and streams it to the other
  signed-in tablets; no refresh is required.
- Direct Supabase realtime is retained only as an outage/disabled fallback.
- Supabase/API responses are never service-worker cached as live data.

Run `npm run check` before deployment. It executes the complete unit/integration
suite and a production build. GitHub Actions runs the same command.

## Notes
- Menu courses are edited and saved directly via Admin > Menu Layout.
- Wines and beverages sync nightly from the hotel website (or manually via Admin > Sync).
  The nightly sync writes the **Milka** workspace only.
- Drinks (cocktails, spirits, beers) can also be edited manually in Admin > Drinks.
- The old shared-password gate (`VITE_ACCESS_PASSWORD`) is now only used in
  local-only mode (when Supabase isn't configured).
