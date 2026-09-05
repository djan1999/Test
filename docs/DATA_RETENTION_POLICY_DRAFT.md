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
| Board version history | Up to 48 prior versions per table, each a full board row incl. guest names and restrictions | `service_tables_history.data`; capped by version count, **not** by age — see the retention row below |
| Recorded gestures (the Logbook) | Party names and seat-level drink/restriction facts in event payloads | `service_events.payload`; append-only, covered by guest erasure |
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
| `service_tables_history` (board undo window) | **DECISION REQUIRED: follow the parent service.** Purge each service's history on the same schedule as the ended service it belongs to (currently proposed: 24 months) — the FK cascade already does this whenever that service is purged, so no separate mechanism is needed, only the same approved period and the same purge run | The **48-version cap is a volume bound, not a retention period.** It is enforced by the write trigger, so it only ever applies while a table is still being written to; once a service ends and its rows go quiet, its retained versions stop being pruned and **persist indefinitely**. Those rows hold guest names and allergy data, so they are personal data for as long as they survive — the same Art. 9 exposure as the board rows themselves. Guest erasure already removes matching versions on request, and a service purge cascades the rest away, but **that purge is a manual Admin action today** and every period in this table is still awaiting controller approval. Until one is approved and the purge is actually run, this data accumulates |
| `service_events` (the Logbook) | **DECISION REQUIRED: follow the parent service**, exactly as for the history above (currently proposed: 24 months) | Same shape of exposure and same mechanism: the composite FK to `services` cascades a purged service's events away, and guest erasure covers the payloads. Append-only by design — clients hold INSERT and SELECT only — so there is no incremental deletion path, and nothing ages out on its own. The same manual-purge and unapproved-period caveats apply |
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
