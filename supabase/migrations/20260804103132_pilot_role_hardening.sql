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
      -- Fail closed: if RLS cannot be enabled, abort the CREATE TABLE command.
      -- Logging and continuing would expose the new table through the Data API.
      execute format('alter table if exists %s enable row level security', command.object_identity);
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

-- A local move/swap/layout change writes several service-table rows in one
-- SQLite transaction. Apply the matching Postgres rows in one function call.
-- A version miss raises 40001 so the entire statement rolls back; callers
-- re-read and fold the whole gesture before retrying.
create or replace function public.save_service_tables_batch_if_current(
  p_workspace_id uuid,
  p_service_id uuid,
  p_rows jsonb,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  changed integer;
  expected_at timestamptz;
  target_table_id integer;
begin
  if p_workspace_id is null or p_service_id is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 2 then
    raise exception 'A service-table batch needs a workspace, service, and at least two rows'
      using errcode = '22023';
  end if;

  for item in
    select value
      from jsonb_array_elements(p_rows)
     order by (value ->> 'table_id')::integer
  loop
    target_table_id := (item ->> 'table_id')::integer;
    expected_at := nullif(item ->> 'expected_updated_at', '')::timestamptz;
    if target_table_id is null then
      raise exception 'Every service-table batch row needs table_id'
        using errcode = '22023';
    end if;

    if expected_at is null then
      insert into public.service_tables(
        workspace_id, service_id, table_id, data, updated_at
      ) values (
        p_workspace_id, p_service_id, target_table_id,
        coalesce(item -> 'data', '{}'::jsonb), p_updated_at
      )
      on conflict (workspace_id, service_id, table_id) do nothing;
    else
      update public.service_tables
         set data = coalesce(item -> 'data', '{}'::jsonb),
             updated_at = p_updated_at
       where workspace_id = p_workspace_id
         and service_id = p_service_id
         and table_id = target_table_id
         and updated_at = expected_at;
    end if;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Service-table batch version changed for table %', target_table_id
        using errcode = '40001';
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.save_service_tables_batch_if_current(
  uuid, uuid, jsonb, timestamptz
) from public, anon;
grant execute on function public.save_service_tables_batch_if_current(
  uuid, uuid, jsonb, timestamptz
) to authenticated, service_role;

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

-- RLS USING/WITH CHECK is not an immutability constraint for a user who is a
-- member of two restaurants: both the old and new tenant can satisfy policy.
-- Make the tenant key immutable on every other workspace-owned row.
create or replace function private.guard_workspace_id_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_workspace_id_immutable()
  from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_members', 'service_tables', 'service_settings',
    'service_archive', 'menu_courses', 'wines', 'beverages',
    'reservations', 'audit_log'
  ] loop
    execute format('drop trigger if exists guard_workspace_id_immutable on public.%I', table_name);
    execute format(
      'create trigger guard_workspace_id_immutable before update on public.%I '
      'for each row execute function private.guard_workspace_id_immutable()',
      table_name
    );
  end loop;
end;
$$;

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

-- â”€â”€ Atomic guest erasure + stale-device replay protection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.privacy_guest_erasures (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name_token text not null check (name_token ~ '^[0-9a-f]{20}$'),
  erased_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  primary key (workspace_id, name_token)
);
alter table public.privacy_guest_erasures enable row level security;
revoke all on table public.privacy_guest_erasures from public, anon, authenticated;
grant select, insert, update, delete on table public.privacy_guest_erasures to service_role;

drop trigger if exists guard_workspace_id_immutable on public.privacy_guest_erasures;
create trigger guard_workspace_id_immutable
before update on public.privacy_guest_erasures
for each row execute function private.guard_workspace_id_immutable();

create or replace function private.privacy_normalize_guest_name(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select lower(regexp_replace(trim(normalize(coalesce(value, ''), NFKC)), '\s+', ' ', 'g'));
$$;

create or replace function private.privacy_guest_token(ws uuid, normalized_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select left(encode(extensions.digest(
    convert_to(ws::text || ':' || coalesce(normalized_name, ''), 'UTF8'),
    'sha256'
  ), 'hex'), 20);
$$;

create or replace function private.privacy_redact_party(value jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(value, '{}'::jsonb) || jsonb_build_object(
    'resName', '[erased]',
    'guestType', '',
    'room', '',
    'rooms', '[]'::jsonb,
    'restrictions', '[]'::jsonb,
    'birthday', false,
    'cakeNote', '',
    'notes', '',
    'source', '',
    'reference', '',
    'kitchenCourseNotes', '{}'::jsonb
  );
$$;

create or replace function private.privacy_redact_value(value jsonb, normalized_name text)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  working jsonb;
  result jsonb;
begin
  if value is null then return null; end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(
      jsonb_agg(private.privacy_redact_value(item, normalized_name) order by ordinal),
      '[]'::jsonb
    ) into result
      from jsonb_array_elements(value) with ordinality as element(item, ordinal);
    return result;
  end if;
  if jsonb_typeof(value) <> 'object' then return value; end if;

  working := case
    when private.privacy_normalize_guest_name(value ->> 'resName') = normalized_name
      then private.privacy_redact_party(value)
    else value
  end;
  select coalesce(
    jsonb_object_agg(key, private.privacy_redact_value(item, normalized_name)),
    '{}'::jsonb
  ) into result
    from jsonb_each(working) as entry(key, item);
  return result;
end;
$$;

create or replace function private.privacy_assert_not_erased(ws uuid, value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  normalized_name text;
  token text;
begin
  if value is null then return; end if;
  if jsonb_typeof(value) = 'array' then
    for item in
      select element.item
        from jsonb_array_elements(value) as element(item)
    loop
      perform private.privacy_assert_not_erased(ws, item);
    end loop;
    return;
  end if;
  if jsonb_typeof(value) <> 'object' then return; end if;

  normalized_name := private.privacy_normalize_guest_name(value ->> 'resName');
  if normalized_name <> '' and normalized_name <> '[erased]' then
    token := private.privacy_guest_token(ws, normalized_name);
    perform pg_advisory_xact_lock(hashtextextended(ws::text || ':' || normalized_name, 0));
    if exists (
      select 1 from public.privacy_guest_erasures erasure
       where erasure.workspace_id = ws and erasure.name_token = token
    ) then
      raise exception 'Guest data was previously erased and cannot be replayed'
        using errcode = 'MG001';
    end if;
  end if;
  for item in
    select entry.item
      from jsonb_each(value) as entry(key, item)
  loop
    perform private.privacy_assert_not_erased(ws, item);
  end loop;
end;
$$;

create or replace function private.guard_erased_guest_reintroduction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name in ('reservations', 'service_tables') then
    perform private.privacy_assert_not_erased(new.workspace_id, new.data);
  elsif tg_table_name = 'service_archive' then
    perform private.privacy_assert_not_erased(new.workspace_id, new.state);
  elsif tg_table_name = 'audit_log' then
    perform private.privacy_assert_not_erased(
      new.workspace_id,
      jsonb_build_array(new.before_data, new.after_data)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.privacy_normalize_guest_name(text),
  private.privacy_guest_token(uuid, text), private.privacy_redact_party(jsonb),
  private.privacy_redact_value(jsonb, text),
  private.privacy_assert_not_erased(uuid, jsonb),
  private.guard_erased_guest_reintroduction()
  from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['reservations', 'service_tables', 'service_archive', 'audit_log'] loop
    execute format('drop trigger if exists guard_erased_guest_reintroduction on public.%I', table_name);
    execute format(
      'create trigger guard_erased_guest_reintroduction before insert or update on public.%I '
      'for each row execute function private.guard_erased_guest_reintroduction()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.erase_workspace_guest(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_normalized_name text,
  p_name_token text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reservation_count integer := 0;
  board_count integer := 0;
  archive_count integer := 0;
  audit_count integer := 0;
begin
  if not exists (
    select 1 from public.workspace_members membership
     where membership.workspace_id = p_workspace_id
       and membership.user_id = p_actor_id
       and membership.role = 'admin'
  ) then
    raise exception 'Only an Admin can erase workspace guest data'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name_token is distinct from private.privacy_guest_token(p_workspace_id, p_normalized_name) then
    raise exception 'Guest erasure token does not match the normalized name'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_normalized_name,
    0
  ));
  insert into public.privacy_guest_erasures(workspace_id, name_token, erased_at, actor_id)
  values (p_workspace_id, p_name_token, clock_timestamp(), p_actor_id)
  on conflict (workspace_id, name_token) do update
    set erased_at = excluded.erased_at, actor_id = excluded.actor_id;

  delete from public.reservations
   where workspace_id = p_workspace_id
     and private.privacy_normalize_guest_name(data ->> 'resName') = p_normalized_name;
  get diagnostics reservation_count = row_count;

  update public.service_tables
     set data = private.privacy_redact_party(data), updated_at = clock_timestamp()
   where workspace_id = p_workspace_id
     and private.privacy_normalize_guest_name(data ->> 'resName') = p_normalized_name;
  get diagnostics board_count = row_count;

  with changed as (
    select id, private.privacy_redact_value(state, p_normalized_name) as redacted
      from public.service_archive
     where workspace_id = p_workspace_id
  )
  update public.service_archive archive
     set state = changed.redacted
    from changed
   where archive.id = changed.id and archive.state is distinct from changed.redacted;
  get diagnostics archive_count = row_count;

  with changed as (
    select id,
      private.privacy_redact_value(before_data, p_normalized_name) as before_redacted,
      private.privacy_redact_value(after_data, p_normalized_name) as after_redacted
      from public.audit_log
     where workspace_id = p_workspace_id
  )
  update public.audit_log audit
     set before_data = changed.before_redacted,
         after_data = changed.after_redacted
    from changed
   where audit.id = changed.id
     and (audit.before_data is distinct from changed.before_redacted
       or audit.after_data is distinct from changed.after_redacted);
  get diagnostics audit_count = row_count;

  insert into public.audit_log(
    workspace_id, actor_id, actor_email, action, entity_type, entity_key,
    before_data, after_data
  ) values (
    p_workspace_id, p_actor_id, p_actor_email, 'delete',
    'privacy_guest_erasure', p_name_token,
    jsonb_build_object('matched', jsonb_build_object(
      'reservations', reservation_count,
      'serviceTables', board_count,
      'legacyArchives', archive_count,
      'auditRows', audit_count
    )),
    jsonb_build_object('status', 'erased')
  );

  return jsonb_build_object('counts', jsonb_build_object(
    'reservations', reservation_count,
    'serviceTables', board_count,
    'legacyArchives', archive_count,
    'auditRows', audit_count
  ));
end;
$$;

revoke all on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  to service_role;

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

-- The neutral client default hides hotel fields. Preserve Milka's room flow
-- even if its config row is missing, and fill only absent feature metadata on
-- an existing row.
insert into public.service_settings(workspace_id, id, state, updated_at)
select workspace.id,
       'restaurant_config_v1',
       jsonb_build_object(
         'version', 1,
         'name', workspace.name,
         'subtitle', 'SERVICE BOARD',
         'features', jsonb_build_object(
           'hotelGuests', true,
           'roomOptions', jsonb_build_array('01', '11', '12', '21', '22', '23')
         )
       ),
       clock_timestamp()
  from public.workspaces workspace
 where workspace.slug = 'milka'
on conflict (workspace_id, id) do update
  set state = jsonb_set(
        public.service_settings.state,
        '{features}',
        excluded.state -> 'features',
        true
      ),
      updated_at = clock_timestamp()
where not (public.service_settings.state ? 'features');

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
