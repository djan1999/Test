-- Architectural rebuild foundations (13.07.2026)
--
-- 1. Replace the legacy owner/staff placeholder with the three operating
--    roles used by the app: admin, service, kitchen.
-- 2. Enforce those roles in Postgres RLS (the UI is convenience; RLS is the
--    actual security boundary).
-- 3. Add an immutable administrative audit trail.
-- 4. Make Data API grants explicit for Supabase's 2026 exposure defaults.

-- ── Three-role membership model ────────────────────────────────────────────

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;

update public.workspace_members set role = 'admin' where role = 'owner';
update public.workspace_members set role = 'service' where role = 'staff';

alter table public.workspace_members
  alter column role set default 'service';

alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('admin', 'service', 'kitchen'));

create or replace function private.workspace_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = ws
    and m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function private.has_workspace_role(ws uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.workspace_role(ws) = any(allowed_roles), false);
$$;

revoke all on function private.workspace_role(uuid) from public, anon;
revoke all on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.workspace_role(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

-- ── Workspace and membership policies ─────────────────────────────────────

drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read" on public.workspaces
  for select to authenticated
  using (private.has_workspace_role(id, array['admin', 'service', 'kitchen']));

drop policy if exists "members_self_read" on public.workspace_members;
drop policy if exists "workspace_members_read" on public.workspace_members;
drop policy if exists "workspace_members_admin_insert" on public.workspace_members;
drop policy if exists "workspace_members_admin_update" on public.workspace_members;
drop policy if exists "workspace_members_admin_delete" on public.workspace_members;

create policy "workspace_members_read" on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_workspace_role(workspace_id, array['admin'])
  );

create policy "workspace_members_admin_insert" on public.workspace_members
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin']));

create policy "workspace_members_admin_update" on public.workspace_members
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

create policy "workspace_members_admin_delete" on public.workspace_members
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

-- A restaurant must always retain at least one Admin. Locking the workspace
-- serializes simultaneous demotions/removals so two admins cannot race each
-- other and accidentally leave the restaurant unmanageable.
create or replace function private.protect_last_workspace_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_admins integer;
begin
  if old.role <> 'admin' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' then
    return new;
  end if;

  perform 1 from public.workspaces where id = old.workspace_id for update;
  select count(*) into remaining_admins
  from public.workspace_members
  where workspace_id = old.workspace_id
    and role = 'admin'
    and user_id <> old.user_id;
  if remaining_admins = 0 then
    raise exception 'Cannot remove or demote the last Admin for this restaurant.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.protect_last_workspace_admin() from public, anon, authenticated;

drop trigger if exists workspace_members_protect_last_admin on public.workspace_members;
create trigger workspace_members_protect_last_admin
before delete or update of role on public.workspace_members
for each row execute function private.protect_last_workspace_admin();

-- ── Operational RLS ────────────────────────────────────────────────────────

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

drop policy if exists "service_archive_member_all" on public.service_archive;
drop policy if exists "service_archive_role_read" on public.service_archive;
drop policy if exists "service_archive_service_insert" on public.service_archive;
drop policy if exists "service_archive_service_update" on public.service_archive;
drop policy if exists "service_archive_service_delete" on public.service_archive;
create policy "service_archive_role_read" on public.service_archive
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "service_archive_service_insert" on public.service_archive
  for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'service']));
create policy "service_archive_service_update" on public.service_archive
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service']))
  with check (private.has_workspace_role(workspace_id, array['admin', 'service']));
create policy "service_archive_service_delete" on public.service_archive
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service']));

-- Settings share one table, so role enforcement also checks the setting key.
-- Service can operate the live service and guest-menu output; Kitchen can
-- order tickets and clear SET strips when a course fires. Admin can edit all.
drop policy if exists "service_settings_member_all" on public.service_settings;
drop policy if exists "service_settings_role_read" on public.service_settings;
drop policy if exists "service_settings_role_insert" on public.service_settings;
drop policy if exists "service_settings_role_update" on public.service_settings;
drop policy if exists "service_settings_admin_delete" on public.service_settings;

create policy "service_settings_role_read" on public.service_settings
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));

create policy "service_settings_role_insert" on public.service_settings
  for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, array['admin'])
    or (
      private.has_workspace_role(workspace_id, array['service'])
      and (
        id in ('service_date', 'floor_status_v1', 'menu_gen_team', 'menu_gen_title', 'menu_gen_thankyou', 'inventory')
        or id like 'inventory_device:%'
      )
    )
    or (
      private.has_workspace_role(workspace_id, array['kitchen'])
      and id in ('kitchen_ticket_order', 'floor_status_v1')
    )
  );

create policy "service_settings_role_update" on public.service_settings
  for update to authenticated
  using (
    private.has_workspace_role(workspace_id, array['admin'])
    or (
      private.has_workspace_role(workspace_id, array['service'])
      and (
        id in ('service_date', 'floor_status_v1', 'menu_gen_team', 'menu_gen_title', 'menu_gen_thankyou', 'inventory')
        or id like 'inventory_device:%'
      )
    )
    or (
      private.has_workspace_role(workspace_id, array['kitchen'])
      and id in ('kitchen_ticket_order', 'floor_status_v1')
    )
  )
  with check (
    private.has_workspace_role(workspace_id, array['admin'])
    or (
      private.has_workspace_role(workspace_id, array['service'])
      and (
        id in ('service_date', 'floor_status_v1', 'menu_gen_team', 'menu_gen_title', 'menu_gen_thankyou', 'inventory')
        or id like 'inventory_device:%'
      )
    )
    or (
      private.has_workspace_role(workspace_id, array['kitchen'])
      and id in ('kitchen_ticket_order', 'floor_status_v1')
    )
  );

create policy "service_settings_admin_delete" on public.service_settings
  for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

-- Reference catalog: everyone may read what service/kitchen needs, but only
-- Admin may change it. Nightly sync uses service_role and bypasses RLS.
drop policy if exists "menu_courses_member_all" on public.menu_courses;
drop policy if exists "menu_courses_role_read" on public.menu_courses;
drop policy if exists "menu_courses_admin_write" on public.menu_courses;
create policy "menu_courses_role_read" on public.menu_courses
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "menu_courses_admin_write" on public.menu_courses
  for all to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

drop policy if exists "wines_member_all" on public.wines;
drop policy if exists "wines_role_read" on public.wines;
drop policy if exists "wines_admin_write" on public.wines;
create policy "wines_role_read" on public.wines
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "wines_admin_write" on public.wines
  for all to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

drop policy if exists "beverages_member_all" on public.beverages;
drop policy if exists "beverages_role_read" on public.beverages;
drop policy if exists "beverages_admin_write" on public.beverages;
create policy "beverages_role_read" on public.beverages
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen']));
create policy "beverages_admin_write" on public.beverages
  for all to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

-- ── Configurable service tables ────────────────────────────────────────────
-- The application still defaults to Milka's T01-T10. The database now accepts
-- a workspace-defined positive table id instead of imposing that house layout
-- on every future configuration.

alter table public.service_tables
  drop constraint if exists service_tables_table_id_check;
alter table public.service_tables
  add constraint service_tables_table_id_check
  check (table_id between 1 and 999);

create or replace function public.archive_and_finish_service(
  p_workspace_id uuid,
  p_archive_id uuid default null,
  p_archive_date date default null,
  p_archive_label text default null,
  p_archive_state jsonb default null,
  p_expected_started_at text default null,
  p_expected_date text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  guarded boolean := (p_expected_started_at is not null or p_expected_date is not null);
  cleared integer := 0;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;
  if p_archive_id is not null and (p_archive_date is null or nullif(p_archive_label, '') is null) then
    raise exception 'archive date and label are required';
  end if;

  update public.service_settings
     set state = '{}'::jsonb, updated_at = clock_timestamp()
   where workspace_id = p_workspace_id
     and id = 'service_date'
     and (
       not guarded
       or (
         (p_expected_started_at is null
           or state->>'startedAt' is null
           or state->>'startedAt' = p_expected_started_at)
         and (p_expected_date is null or state->>'date' = p_expected_date)
       )
     );
  get diagnostics cleared = row_count;

  if guarded and cleared = 0 then
    return jsonb_build_object('superseded', true);
  end if;

  if cleared = 0 then
    insert into public.service_settings(workspace_id, id, state, updated_at)
    values (p_workspace_id, 'service_date', '{}'::jsonb, clock_timestamp())
    on conflict (workspace_id, id)
    do update set state = '{}'::jsonb, updated_at = excluded.updated_at;
  end if;

  if p_archive_id is not null then
    insert into public.service_archive(
      id, workspace_id, date, label, state, created_at, deleted_at
    )
    values (
      p_archive_id, p_workspace_id, p_archive_date, p_archive_label,
      coalesce(p_archive_state, '{}'::jsonb), clock_timestamp(), null
    )
    on conflict (id) do nothing;
  end if;

  -- Clear exactly the rows this workspace currently owns. This automatically
  -- covers 6, 10, 14, or any later configured table count and also cleans old
  -- retired rows left from a previous layout.
  update public.service_tables
     set data = '{}'::jsonb, updated_at = clock_timestamp()
   where workspace_id = p_workspace_id;

  return jsonb_build_object('superseded', false);
end;
$$;

revoke all on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  from public, anon;
grant execute on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  to authenticated, service_role;

-- ── Administrative audit log ───────────────────────────────────────────────

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_key text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log add column if not exists actor_email text;

create index if not exists audit_log_workspace_created_idx
  on public.audit_log(workspace_id, created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read" on public.audit_log
  for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

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
  -- Server maintenance (nightly catalog replacement and migrations) has no
  -- signed-in actor and may touch hundreds of rows. Keep this a useful human
  -- audit trail; interactive admin writes always carry auth.uid().
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Operational settings change constantly during service and do not belong
  -- in the administrative audit trail.
  if tg_table_name = 'service_settings' and (
    setting_id in ('service_date', 'floor_status_v1', 'kitchen_ticket_order', 'menu_gen_team', 'menu_gen_title', 'menu_gen_thankyou', 'inventory')
    or setting_id like 'inventory_device:%'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
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
    ws, (select auth.uid()), auth.jwt() ->> 'email', lower(tg_op), tg_table_name, row_key, old_row, new_row
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.capture_admin_audit() from public, anon, authenticated;

drop trigger if exists workspace_members_admin_audit on public.workspace_members;
create trigger workspace_members_admin_audit
after insert or update or delete on public.workspace_members
for each row execute function private.capture_admin_audit();

drop trigger if exists menu_courses_admin_audit on public.menu_courses;
create trigger menu_courses_admin_audit
after insert or update or delete on public.menu_courses
for each row execute function private.capture_admin_audit();

drop trigger if exists wines_admin_audit on public.wines;
create trigger wines_admin_audit
after insert or update or delete on public.wines
for each row execute function private.capture_admin_audit();

drop trigger if exists beverages_admin_audit on public.beverages;
create trigger beverages_admin_audit
after insert or update or delete on public.beverages
for each row execute function private.capture_admin_audit();

drop trigger if exists service_settings_admin_audit on public.service_settings;
create trigger service_settings_admin_audit
after insert or update or delete on public.service_settings
for each row execute function private.capture_admin_audit();

-- ── Explicit Data API privileges ───────────────────────────────────────────
-- RLS still decides which rows/actions are allowed. These grants only make
-- the tables reachable through supabase-js/PostgREST.

revoke all on table public.workspaces, public.workspace_members,
  public.service_tables, public.service_settings, public.service_archive,
  public.menu_courses, public.wines, public.beverages, public.reservations,
  public.audit_log from anon;

grant select on table public.workspaces, public.workspace_members,
  public.service_tables, public.service_settings, public.service_archive,
  public.menu_courses, public.wines, public.beverages, public.reservations,
  public.audit_log to authenticated;

grant insert, update, delete on table public.workspace_members,
  public.service_tables, public.service_settings, public.service_archive,
  public.menu_courses, public.wines, public.beverages, public.reservations
  to authenticated;

grant usage, select on all sequences in schema public to authenticated, service_role;
