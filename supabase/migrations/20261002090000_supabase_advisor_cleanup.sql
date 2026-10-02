-- ── Supabase performance-advisor cleanup ─────────────────────────────────────
--
-- 1. auth_rls_initplan: service_events_member_append called auth.uid() bare,
--    so Postgres re-evaluated it for every inserted row. Wrapped in a scalar
--    sub-select it becomes an InitPlan, evaluated once per statement. The
--    rule itself is unchanged.
drop policy if exists "service_events_member_append" on public.service_events;
create policy "service_events_member_append" on public.service_events
  for insert with check (
    private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen'])
    and actor_id is not distinct from (select auth.uid())
  );

-- 2. unindexed_foreign_keys: deleting a service (ON DELETE CASCADE into the
--    board history) or an auth user (ON DELETE SET NULL on erasure records)
--    scanned these tables whole to find the referencing rows.
create index if not exists service_tables_history_service_idx
  on public.service_tables_history (service_id);
create index if not exists privacy_guest_erasures_actor_idx
  on public.privacy_guest_erasures (actor_id)
  where actor_id is not null;

-- 3. unused_index: never scanned since stats reset (13.08), and each one is
--    a duplicate of, or a leading-column prefix of, an index that stays, so
--    no query loses its access path. Every write paid to maintain them —
--    service_tables_workspace_updated_idx most of all: it sits on the busiest
--    table and indexes updated_at, which every board save changes, so it also
--    blocked HOT updates there. Each is recreatable from its original
--    migration if ever needed.
drop index if exists public.service_settings_ws_idx;                          -- = service_settings_pkey (workspace_id, id)
drop index if exists public.menu_courses_ws_idx;                              -- prefix of menu_courses_pkey
drop index if exists public.service_archive_ws_idx;                           -- prefix of service_archive_workspace_date_deleted_created_idx
drop index if exists public.beverages_workspace_source_category_position_idx; -- beverages_ws_idx covers the filter; position sort is a few rows
drop index if exists public.workspace_members_workspace_created_idx;          -- prefix of workspace_members_pkey; a handful of members per workspace
drop index if exists public.service_tables_workspace_updated_idx;             -- service_tables_ws_idx / pkey serve every workspace read

-- Deliberately KEPT although the advisor lists them as unused:
--   workspace_members_user_idx  — backs the user_id FK (ON DELETE CASCADE)
--   audit_log_actor_idx         — backs the actor_id FK (ON DELETE SET NULL)
--   services_workspace_date_idx — date-ordered service history; services
--                                 are written about once a night, so cheap
