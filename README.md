# Milka Service Board

## Multi-restaurant (workspaces) + login
The app now requires a Supabase **email + password login**, and all data is
isolated per **restaurant (workspace)**:

- **Restaurant logins** only ever see their own restaurant's data.
- A **master / platform-admin account** (the "Demo" account) can enter and
  control *every* restaurant — the real cross-restaurant admin. Membership in
  the `platform_admins` table grants this.
- After login, a **profile picker** lets the master account choose a restaurant
  and switch between them (single-restaurant logins skip the picker). Switching
  reloads the app so each restaurant's data loads cleanly and never bleeds into
  another.

Every data table carries a `workspace_id`; the `scopedFrom()` helper
(`src/lib/scopedDb.js`) scopes all reads/writes, realtime is filtered per
workspace, and the offline write-queue stamps the workspace at enqueue time.

## Required Supabase setup
1. Open the Supabase SQL editor and run `schema.sql` (creates the tenancy
   foundation: `workspaces`, `workspace_members`, `platform_admins`).
2. Put your Supabase URL and anon key into `.env` (see `env.example`).
3. Create users in **Authentication → Users**, then link them:
   - a restaurant login → a row in `workspace_members` for that workspace;
   - the master account → a row in `platform_admins`.
4. Start the app with `npm install` and `npm run dev`.

## Notes
- Menu courses are edited and saved directly via Admin > Menu Layout.
- Wines and beverages sync nightly from the hotel website (or manually via Admin > Sync).
  The nightly sync writes the **Milka** workspace only.
- Drinks (cocktails, spirits, beers) can also be edited manually in Admin > Drinks.
- The old shared-password gate (`VITE_ACCESS_PASSWORD`) is now only used in
  local-only mode (when Supabase isn't configured).
