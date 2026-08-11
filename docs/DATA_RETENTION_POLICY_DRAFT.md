# Data retention policy — DRAFT (requires controller sign-off)

Status: **DRAFT.** The numbers below are engineering recommendations. The
restaurant (data controller) and the operator must sign off before the first
external restaurant handles real guest data, and the final wording needs
professional legal review (see PILOT_ROLLOUT privacy gate).

## What we hold, and where

| Data | Contains | Location(s) |
|---|---|---|
| Reservations | Guest name, party size, hotel room, birthday flag, dietary restrictions, free-text notes | `reservations.data` (JSONB) |
| Live/ended service boards | Per-seat guest names, restrictions, notes | `services` + `service_tables.data`; ended services ARE the archive |
| Legacy archive snapshots | Full frozen nights incl. guest names | `service_archive.state` |
| Audit trail | Staff emails, before/after row images (snapshots/state redacted since the pilot hardening) | `audit_log` |
| Device copies | Full synced copy of the above, unencrypted at rest | Each tablet's PowerSync SQLite + localStorage |

Dietary/allergy data tied to a named guest is GDPR **Article 9
special-category data**. Treat every table above accordingly.

## Recommended retention (DECISION REQUIRED per line)

| Data | Recommendation | Rationale |
|---|---|---|
| Reservations (past dates) | 24 months, then delete | Year-over-year planning needs one full season of comparison |
| Ended services + board rows | 24 months, then purge (admin trash → purge flow) | Same operational history window |
| `service_tables_history` (board undo window) | **No decision needed — already self-limiting.** Newest 48 versions per workspace/service/table, pruned on every write; cascades away with a purged service and is deleted for an erased guest | An operational undo window, not a retained record. Note it holds guest names for as long as a version survives, so it is in scope for erasure (it is already covered) even though it needs no retention period |
| Legacy `service_archive` | 24 months from `created_at`, then purge | Superseded by the service-entity model |
| `audit_log` | 36 months, then delete | Accountability window longer than data window |
| Guest erasure register (`privacy_guest_erasures`) | Indefinite | Tokens only (no names); required to keep erasure effective against stale devices |

## Mechanisms (already available)

- **Export**: `/api/privacy` workspace export (admin-only, streaming JSON).
- **Erasure**: `/api/privacy` guest erasure — deletes reservations, redacts
  board/archive/audit copies atomically, records a compensating audit row, and
  blocks stale-device replays via the erasure register (tested in
  `pilot_role_matrix.sql`).
- **Not yet built**: scheduled deletion enforcing the table above. Until it
  exists, retention is enforced manually each quarter (calendar reminder) via
  the archive purge flow and a documented reservations cleanup.

## Open decisions for sign-off

1. Confirm/adjust the retention numbers above.
2. Who executes the quarterly manual purge until automation exists?
3. Device policy: tablets hold unencrypted guest data — require device
   PIN/lock and enrol every tablet in the lost-device procedure
   (SUPPORT_PLAYBOOK.md).
4. Sub-processor list for the restaurant-facing DPA: Supabase (EU region),
   Vercel, PowerSync (JourneyApps). Confirm DPAs for each.
