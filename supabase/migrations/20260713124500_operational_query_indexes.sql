-- Indexes for the queries that stay hot as years of restaurant history grow.
-- The first column is always workspace_id so each restaurant remains isolated
-- and Postgres can satisfy the RLS-scoped read without scanning other tenants.

create index if not exists service_archive_active_recent_idx
  on public.service_archive(workspace_id, created_at desc)
  where deleted_at is null;

create index if not exists service_archive_trash_recent_idx
  on public.service_archive(workspace_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists wines_workspace_name_idx
  on public.wines(workspace_id, name);

create index if not exists beverages_workspace_position_idx
  on public.beverages(workspace_id, position);

create index if not exists workspace_members_workspace_created_idx
  on public.workspace_members(workspace_id, created_at);

create index if not exists audit_log_actor_idx
  on public.audit_log(actor_id)
  where actor_id is not null;
