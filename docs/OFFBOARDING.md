# Restaurant offboarding procedure

When a restaurant stops using the platform, follow these steps IN ORDER.
The order matters: export before any destruction, and never hard-delete the
workspace row as a first step — `workspaces` deletion CASCADES through every
operational table **including the audit trail**, which destroys the record
that the offboarding itself was done properly.

## 1. Export (mandatory, before anything else)

- Run the admin workspace export (`/api/privacy`, DATA & PRIVACY panel) and
  deliver the JSON to the restaurant. This is their data; they leave with it.
- Record date, actor, and delivery method.

## 2. Freeze access

- Restaurant Admin (or operator) removes all `workspace_members` rows except
  one admin used for the remaining steps. Each removal is audit-logged.
- Operator signs out all affected users' sessions in Supabase Auth. Auth
  accounts themselves are deleted only if the person has no other workspace
  membership.

## 3. Retention window (default: 30 days — DECISION REQUIRED)

- Keep the workspace intact but memberless for the agreed window in case the
  restaurant returns or disputes the export. No sync streams run without
  memberships; the data is cold.

## 4. Deletion after the window

Preferred order, so an audit trail of the deletion survives until the end:

1. Purge operational data via the app's own flows where possible (archive
   trash → purge), then delete remaining reservations/board rows with
   scoped SQL (workspace-filtered), keeping `audit_log` for last.
2. Export the workspace's `audit_log` slice to cold storage if the retention
   policy requires keeping it beyond workspace deletion.
3. Finally delete the `workspaces` row (cascades what remains) and the
   erasure-register rows for that workspace.
4. Verify: no rows for the workspace id remain in any `public` table.

## 5. Devices

- The restaurant's tablets still hold local copies. Instruct the restaurant
  to sign out (which clears on next different-user sign-in) or uninstall the
  PWA / clear site data on each device, and confirm in writing.

## Notes

- Never reuse a departed restaurant's workspace row or slug for a new
  customer; onboard fresh (`scripts/onboard-restaurant.mjs`).
- Guest-erasure register rows are name-token-only; deleting them with the
  workspace is acceptable since the guarded tables are gone too.
