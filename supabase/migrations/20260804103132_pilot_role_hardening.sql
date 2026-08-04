-- Pilot readiness: make the documented role matrix and tenant boundary an
-- executable database contract. This migration is intentionally additive and
-- non-destructive to restaurant data.

-- ── Canonical bootstrap / production-drift alignment ───────────────────
-- The live helper predated the hardened empty search_path in schema.sql. Keep
-- fresh bootstrap and production identical, and make future public tables fail
-- safely toward RLS-on. The three dropped trigger helpers have no triggers or
-- dependencies; they are abandoned pre-architecture-rebuild artifacts.
create or replace function private.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workspace_members membership
     where membership.workspace_id = ws
       and membership.user_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $$
declare
  command record;
begin
  for command in
    select *
      from pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
       and object_type in ('table', 'partitioned table')
  loop
    if command.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', command.object_identity);
      exception when others then
        raise log 'rls_auto_enable failed for %', command.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

drop function if exists public.set_updated_at_service_settings();
drop function if exists public.set_updated_at_service_tables();
drop function if exists public.update_synced_at();

-- ── Cross-tenant relational integrity ─────────────────────────────────────
-- A service-table row used to reference services(id) only. A caller who was a
-- member of two restaurants could therefore combine workspace A with a
-- service id from workspace B. RLS saw an allowed A row, while the FK saw a
-- valid B service. Make the workspace part of the relationship itself.
do $$
begin
  if exists (
    select 1
      from public.service_tables st
      join public.services s on s.id = st.service_id
     where st.workspace_id <> s.workspace_id
  ) then
    raise exception 'Cannot install tenant FK: cross-workspace service_tables rows exist';
  end if;
end;
$$;

alter table public.services
  drop constraint if exists services_workspace_id_id_key;
alter table public.services
  add constraint services_workspace_id_id_key unique (workspace_id, id);

alter table public.service_tables
  drop constraint if exists service_tables_service_fk;
alter table public.service_tables
  drop constraint if exists service_tables_service_id_fkey;
alter table public.service_tables
  add constraint service_tables_workspace_service_fk
  foreign key (workspace_id, service_id)
  references public.services(workspace_id, id)
  on delete cascade;

-- Every fallback Realtime channel is filtered by workspace_id. PostgreSQL's
-- default DELETE payload contains primary-key columns only, so filters on
-- workspace_id silently miss deletes unless the old row is fully published.
alter table public.services replica identity full;
alter table public.service_tables replica identity full;
alter table public.service_settings replica identity full;
alter table public.service_archive replica identity full;
alter table public.menu_courses replica identity full;
alter table public.wines replica identity full;
alter table public.beverages replica identity full;
alter table public.reservations replica identity full;

-- Service identity never changes. Service staff may operate lifecycle fields,
-- but archive trash/restore remains an Admin action. Trusted service-role
-- maintenance has no auth.uid() and is deliberately left available.
create or replace function private.guard_service_identity_and_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.started_at is distinct from old.started_at then
    raise exception 'Service identity, workspace, and start time are immutable'
      using errcode = 'insufficient_privilege';
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if not private.has_workspace_role(old.workspace_id, array['admin'])
     and new.deleted_at is distinct from old.deleted_at then
    raise exception 'Only an Admin may change service archive fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_service_identity_and_archive()
  from public, anon, authenticated;

drop trigger if exists services_guard_identity_and_archive on public.services;
create trigger services_guard_identity_and_archive
before update on public.services
for each row execute function private.guard_service_identity_and_archive();

-- ── Role-scoped RLS ────────────────────────────────────────────────────────
drop policy if exists "services_member_select" on public.services;
drop policy if exists "services_member_insert" on public.services;
drop policy if exists "services_member_update" on public.services;
drop policy if exists "services_purge_trash_only" on public.services;
drop policy if exists "services_role_select" on public.services;
drop policy if exists "services_role_insert" on public.services;
drop policy if exists "services_role_update" on public.services;
drop policy if exists "services_admin_purge_trash" on public.services;

create policy "services_role_select" on public.services
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));

create policy "services_role_insert" on public.services
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'service']));

create policy "services_role_update" on public.services
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service']))
  with check (private.has_workspace_role(workspace_id, array['admin', 'service']));

create policy "services_admin_purge_trash" on public.services
  for delete to authenticated
  using (
    private.has_workspace_role(workspace_id, array['admin'])
    and status = 'ended'
    and deleted_at is not null
  );

-- Kitchen writes service_tables because the KDS records fire times, notes,
-- SET state, and seat/terrace changes. Reservation insert/update is also
-- intentional: the kitchen floor can seat or move a walk-in. Destructive
-- reservation and board deletes remain Service/Admin and Admin respectively.
drop policy if exists "service_tables_member_all" on public.service_tables;
drop policy if exists "service_tables_role_read" on public.service_tables;
drop policy if exists "service_tables_role_insert" on public.service_tables;
drop policy if exists "service_tables_role_update" on public.service_tables;
drop policy if exists "service_tables_admin_delete" on public.service_tables;

create policy "service_tables_role_read" on public.service_tables
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "service_tables_role_insert" on public.service_tables
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "service_tables_role_update" on public.service_tables
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']))
  with check (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "service_tables_admin_delete" on public.service_tables
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

drop policy if exists "reservations_member_all" on public.reservations;
drop policy if exists "reservations_role_read" on public.reservations;
drop policy if exists "reservations_role_insert" on public.reservations;
drop policy if exists "reservations_role_update" on public.reservations;
drop policy if exists "reservations_service_delete" on public.reservations;

create policy "reservations_role_read" on public.reservations
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "reservations_role_insert" on public.reservations
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "reservations_role_update" on public.reservations
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']))
  with check (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "reservations_service_delete" on public.reservations
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service']));

-- Legacy snapshots may still be created by Service during the compatibility
-- window. Trash, restore, and permanent delete are Admin-only.
drop policy if exists "service_archive_member_all" on public.service_archive;
drop policy if exists "service_archive_role_read" on public.service_archive;
drop policy if exists "service_archive_service_insert" on public.service_archive;
drop policy if exists "service_archive_service_update" on public.service_archive;
drop policy if exists "service_archive_service_delete" on public.service_archive;
drop policy if exists "service_archive_admin_update" on public.service_archive;
drop policy if exists "service_archive_admin_delete" on public.service_archive;

create policy "service_archive_role_read" on public.service_archive
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "service_archive_service_insert" on public.service_archive
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'service']));
create policy "service_archive_admin_update" on public.service_archive
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "service_archive_admin_delete" on public.service_archive
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

-- Reference catalogues have one read policy for all restaurant roles and
-- action-specific Admin write policies. A single FOR ALL Admin policy also
-- participates in SELECT, producing duplicate permissive policy evaluation.
drop policy if exists "menu_courses_admin_write" on public.menu_courses;
drop policy if exists "menu_courses_admin_insert" on public.menu_courses;
drop policy if exists "menu_courses_admin_update" on public.menu_courses;
drop policy if exists "menu_courses_admin_delete" on public.menu_courses;
create policy "menu_courses_admin_insert" on public.menu_courses
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "menu_courses_admin_update" on public.menu_courses
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "menu_courses_admin_delete" on public.menu_courses
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

drop policy if exists "wines_admin_write" on public.wines;
drop policy if exists "wines_admin_insert" on public.wines;
drop policy if exists "wines_admin_update" on public.wines;
drop policy if exists "wines_admin_delete" on public.wines;
create policy "wines_admin_insert" on public.wines
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "wines_admin_update" on public.wines
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "wines_admin_delete" on public.wines
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

drop policy if exists "beverages_admin_write" on public.beverages;
drop policy if exists "beverages_admin_insert" on public.beverages;
drop policy if exists "beverages_admin_update" on public.beverages;
drop policy if exists "beverages_admin_delete" on public.beverages;
create policy "beverages_admin_insert" on public.beverages
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "beverages_admin_update" on public.beverages
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));
create policy "beverages_admin_delete" on public.beverages
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

-- Production accumulated this exact duplicate of
-- wines_workspace_source_country_idx outside migration history.
drop index if exists public.wines_ws_idx;

-- ── Lifecycle/archive audit coverage without duplicating guest snapshots ──
create or replace function private.capture_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  ws uuid := coalesce((new_row ->> 'workspace_id')::uuid, (old_row ->> 'workspace_id')::uuid);
  row_key text;
  setting_id text := coalesce(new_row ->> 'id', old_row ->> 'id');
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'service_settings' and (
    setting_id in ('service_date', 'floor_status_v1', 'kitchen_ticket_order', 'menu_gen_team', 'menu_gen_title', 'menu_gen_thankyou', 'inventory')
    or setting_id like 'inventory_device:%'
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- The audit needs lifecycle facts, not a second copy of every guest/order.
  if tg_table_name = 'services' then
    old_row := old_row - 'snapshot';
    new_row := new_row - 'snapshot';
  elsif tg_table_name = 'service_archive' then
    old_row := old_row - 'state';
    new_row := new_row - 'state';
  end if;

  row_key := coalesce(
    new_row ->> 'id', old_row ->> 'id',
    new_row ->> 'key', old_row ->> 'key',
    new_row ->> 'position', old_row ->> 'position',
    new_row ->> 'user_id', old_row ->> 'user_id'
  );

  insert into public.audit_log(
    workspace_id, actor_id, actor_email, action, entity_type, entity_key, before_data, after_data
  ) values (
    ws, (select auth.uid()), auth.jwt() ->> 'email', lower(tg_op),
    tg_table_name, row_key, old_row, new_row
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.capture_admin_audit()
  from public, anon, authenticated;

drop trigger if exists services_lifecycle_audit on public.services;
create trigger services_lifecycle_audit
after insert or update or delete on public.services
for each row execute function private.capture_admin_audit();

drop trigger if exists service_archive_admin_audit on public.service_archive;
create trigger service_archive_admin_audit
after insert or update or delete on public.service_archive
for each row execute function private.capture_admin_audit();

-- Existing settings predate provider metadata. Mark only rows whose saved
-- source URL is recognizably Hotel Milka; every other/new workspace stays off.
update public.service_settings settings
   set state = jsonb_set(settings.state, '{provider}', '"milka"'::jsonb, true),
       updated_at = clock_timestamp()
 where settings.id = 'wine_sync_config'
   and coalesce(settings.state ->> 'provider', '') = ''
   and exists (
     select 1
       from jsonb_array_elements(coalesce(settings.state -> 'beveragePages', '[]'::jsonb)) page
      where page ->> 'url' ilike '%hotelmilka.si%'
   );

-- The new neutral default hides hotel fields. Preserve Milka's existing room
-- workflow explicitly in workspace data before the generic client ships.
update public.service_settings settings
   set state = jsonb_set(
         settings.state,
         '{features}',
         jsonb_build_object(
           'hotelGuests', true,
           'roomOptions', jsonb_build_array('01', '11', '12', '21', '22', '23')
         ),
         true
       ),
       updated_at = clock_timestamp()
  from public.workspaces workspace
 where settings.workspace_id = workspace.id
   and workspace.slug = 'milka'
   and settings.id = 'restaurant_config_v1'
   and not (settings.state ? 'features');

-- ── Explicit least-privilege Data API grants ───────────────────────────────
-- RLS controls rows, while these grants control available SQL verbs. Revoke
-- legacy ALL/TRUNCATE grants before rebuilding the exact client surface.
revoke all on table public.workspaces, public.workspace_members,
  public.services, public.service_tables, public.service_settings,
  public.service_archive, public.menu_courses, public.wines,
  public.beverages, public.reservations, public.audit_log
  from anon, authenticated;

grant select on table public.workspaces, public.workspace_members,
  public.services, public.service_tables, public.service_settings,
  public.service_archive, public.menu_courses, public.wines,
  public.beverages, public.reservations, public.audit_log
  to authenticated;

grant insert, update, delete on table public.workspace_members,
  public.services, public.service_tables, public.service_settings,
  public.service_archive, public.menu_courses, public.wines,
  public.beverages, public.reservations
  to authenticated;

-- A production-only emergency copy was left in the exposed public schema.
-- Keep it recoverable for now, but make it unreachable to browser roles.
do $$
begin
  if to_regclass('public.service_tables_backup_20260724') is not null then
    execute 'revoke all on table public.service_tables_backup_20260724 from anon, authenticated';
    execute 'alter table public.service_tables_backup_20260724 enable row level security';
    if to_regclass('private.service_tables_backup_20260724') is not null then
      raise exception 'Cannot move emergency backup: private target already exists';
    end if;
    execute 'alter table public.service_tables_backup_20260724 set schema private';
  end if;
end;
$$;
