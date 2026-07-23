# Managed Restaurant Onboarding

Managed onboarding creates one isolated restaurant workspace, its first Admin membership, restaurant branding, timezone metadata, and empty service-table rows.

It does **not** copy Milka guests, reservations, menus, wines, beverages, archives, service dates, or table activity. The existing `/` Service/Kitchen/Admin application path is unchanged.

## Safety model

- Onboarding lives only at `/platform-onboarding`.
- `VITE_ENABLE_MANAGED_ONBOARDING` is `false` unless explicitly enabled for a build.
- `PLATFORM_ADMIN_USER_IDS` is a server-only comma-separated allowlist of Supabase Auth user UUIDs. Email address and editable user metadata never grant platform access.
- The Supabase secret key stays in the Vercel server function and is never sent to a browser.
- The browser supplies its short-lived login token; the server verifies it with Supabase Auth.
- Database creation runs through `provision_managed_restaurant` as one transaction. A database error rolls back the workspace, memberships, settings, table rows, and audit event together.
- The function is `SECURITY INVOKER`; `anon` and `authenticated` cannot execute it. Only `service_role` can.
- The operator can choose an ordinary, visible additional Admin membership. This uses the same tenant RLS path as every other Admin and is not a hidden cross-tenant bypass. If the operator is also the first Admin email, that first membership is still required.

Supabase Auth invitation is external to the database transaction. In the rare case that Auth succeeds and the database call then fails, the user account can remain unlinked; retrying with the same email safely reuses that account.

## Activation order

Do not activate this during restaurant service.

1. Keep production on the current build and leave `VITE_ENABLE_MANAGED_ONBOARDING=false`.
2. Apply `supabase/migrations/20260720203553_managed_restaurant_provisioning.sql` to a development database or reviewed Supabase branch.
3. Set `PLATFORM_ADMIN_USER_IDS` to the exact Supabase Auth UUID of the trusted operator account.
4. Set `VITE_ENABLE_MANAGED_ONBOARDING=true` in **Preview only**.
5. Open `/platform-onboarding`, create a disposable restaurant, and verify:
   - the first Admin receives/accepts the invitation;
   - the restaurant picker shows only memberships granted to that login;
   - Service, Kitchen, and Admin roles remain isolated;
   - no Milka rows changed;
   - the new workspace has only its configured empty tables;
   - creation appears in `audit_log`.
6. Delete the disposable workspace after the test.
7. Run the full deployment checklist and role/device drills before enabling production onboarding.

## Current scope

The onboarding form stores `restaurant_operations_v1.timezone` for the tenant, but the current service/reservation screens still use the existing deployment-wide sitting-time and room defaults. Those screens must be moved to tenant-specific operations settings before onboarding a restaurant with different hours or room labels.

Menu, drinks, floor maps, staff Service/Kitchen invites, and restaurant-specific reservation settings remain explicit post-onboarding setup steps. This is intentional: it avoids silently copying Milka-specific operational data into a new tenant.
