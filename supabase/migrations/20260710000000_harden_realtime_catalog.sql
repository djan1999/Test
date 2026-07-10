-- Atomic catalog replacement and indexes used by live service reads.
-- Generated for the 2026-07-10 realtime hardening release.

create index if not exists service_tables_workspace_updated_idx
  on public.service_tables(workspace_id, updated_at);
create index if not exists service_settings_workspace_updated_idx
  on public.service_settings(workspace_id, updated_at);
create index if not exists reservations_workspace_date_created_idx
  on public.reservations(workspace_id, date, created_at);
create index if not exists service_archive_workspace_date_deleted_created_idx
  on public.service_archive(workspace_id, date, deleted_at, created_at desc);
drop index if exists public.wines_source_country_idx;
create index if not exists wines_workspace_source_country_idx
  on public.wines(workspace_id, source, country);
drop index if exists public.beverages_source_category_idx;
create index if not exists beverages_workspace_source_category_position_idx
  on public.beverages(workspace_id, source, category, position);

create or replace function public.replace_synced_catalog(
  p_workspace_id uuid,
  p_wines jsonb default '[]'::jsonb,
  p_wine_countries text[] default '{}'::text[],
  p_beverages jsonb default '[]'::jsonb,
  p_beverage_categories text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wine_count integer := 0;
  beverage_count integer := 0;
  empty_category text;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;
  if jsonb_typeof(coalesce(p_wines, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_beverages, '[]'::jsonb)) <> 'array' then
    raise exception 'catalog payloads must be JSON arrays';
  end if;

  select c.category_name into empty_category
  from unnest(coalesce(p_beverage_categories, '{}'::text[])) as c(category_name)
  where not exists (
    select 1
    from jsonb_to_recordset(coalesce(p_beverages, '[]'::jsonb))
      as b(category text, name text, notes text, position integer, source text)
    where b.category = c.category_name
  )
  limit 1;
  if empty_category is not null then
    raise exception 'refusing to replace beverage category % with zero rows', empty_category;
  end if;

  delete from public.wines
   where workspace_id = p_workspace_id
     and source = 'sync'
     and country = any(coalesce(p_wine_countries, '{}'::text[]));

  insert into public.wines (
    workspace_id, key, producer, name, wine_name, vintage, region,
    country, by_glass, source, updated_at
  )
  select
    p_workspace_id, w.key, w.producer, w.name, w.wine_name,
    coalesce(nullif(w.vintage, ''), 'NV'), w.region, w.country,
    coalesce(w.by_glass, false), 'sync', now()
  from jsonb_to_recordset(coalesce(p_wines, '[]'::jsonb)) as w(
    key text, producer text, name text, wine_name text, vintage text,
    region text, country text, by_glass boolean, source text
  )
  where w.key is not null and w.producer is not null and w.name is not null
  on conflict (workspace_id, key) do nothing;
  get diagnostics wine_count = row_count;

  delete from public.beverages
   where workspace_id = p_workspace_id
     and source = 'sync'
     and category = any(coalesce(p_beverage_categories, '{}'::text[]));

  insert into public.beverages (
    workspace_id, category, name, notes, position, source, updated_at
  )
  select
    p_workspace_id, b.category, b.name, coalesce(b.notes, ''),
    coalesce(b.position, 0), 'sync', now()
  from jsonb_to_recordset(coalesce(p_beverages, '[]'::jsonb)) as b(
    category text, name text, notes text, position integer, source text
  )
  where b.category is not null and b.name is not null;
  get diagnostics beverage_count = row_count;

  return jsonb_build_object('wines', wine_count, 'beverages', beverage_count);
end;
$$;

revoke all on function public.replace_synced_catalog(uuid, jsonb, text[], jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.replace_synced_catalog(uuid, jsonb, text[], jsonb, text[])
  to service_role;

create or replace function public.save_service_table_if_current(
  p_workspace_id uuid,
  p_table_id integer,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer := 0;
begin
  if p_expected_updated_at is null then
    insert into public.service_tables(workspace_id, table_id, data, updated_at)
    values (p_workspace_id, p_table_id, coalesce(p_data, '{}'::jsonb), p_updated_at)
    on conflict (workspace_id, table_id) do nothing;
  else
    update public.service_tables
       set data = coalesce(p_data, '{}'::jsonb), updated_at = p_updated_at
     where workspace_id = p_workspace_id
       and table_id = p_table_id
       and updated_at = p_expected_updated_at;
  end if;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_service_table_if_current(uuid, integer, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_table_if_current(uuid, integer, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;

create or replace function public.archive_and_finish_service(
  p_workspace_id uuid,
  p_archive_id uuid default null,
  p_archive_date date default null,
  p_archive_label text default null,
  p_archive_state jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;

  if p_archive_id is not null then
    if p_archive_date is null or nullif(p_archive_label, '') is null then
      raise exception 'archive date and label are required';
    end if;
    insert into public.service_archive(
      id, workspace_id, date, label, state, created_at, deleted_at
    )
    values (
      p_archive_id, p_workspace_id, p_archive_date, p_archive_label,
      coalesce(p_archive_state, '{}'::jsonb), clock_timestamp(), null
    )
    on conflict (id) do nothing;
  end if;

  insert into public.service_tables(workspace_id, table_id, data, updated_at)
  select p_workspace_id, table_id, '{}'::jsonb, clock_timestamp()
  from generate_series(1, 10) as table_id
  on conflict (workspace_id, table_id)
  do update set data = '{}'::jsonb, updated_at = excluded.updated_at;

  insert into public.service_settings(workspace_id, id, state, updated_at)
  values (p_workspace_id, 'service_date', '{}'::jsonb, clock_timestamp())
  on conflict (workspace_id, id)
  do update set state = '{}'::jsonb, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb)
  from public, anon;
grant execute on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb)
  to authenticated, service_role;


create or replace function private.is_workspace_owner(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;
revoke execute on function private.is_workspace_owner(uuid) from anon, public;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

drop policy if exists "menu_courses_member_all" on public.menu_courses;
create policy "menu_courses_member_read" on public.menu_courses
  for select to authenticated
  using (private.is_workspace_member(workspace_id) or private.is_platform_admin());
create policy "menu_courses_owner_write" on public.menu_courses
  for all to authenticated
  using (private.is_workspace_owner(workspace_id) or private.is_platform_admin())
  with check (private.is_workspace_owner(workspace_id) or private.is_platform_admin());

drop policy if exists "wines_member_all" on public.wines;
create policy "wines_member_read" on public.wines
  for select to authenticated
  using (private.is_workspace_member(workspace_id) or private.is_platform_admin());
create policy "wines_owner_write" on public.wines
  for all to authenticated
  using (private.is_workspace_owner(workspace_id) or private.is_platform_admin())
  with check (private.is_workspace_owner(workspace_id) or private.is_platform_admin());

drop policy if exists "beverages_member_all" on public.beverages;
create policy "beverages_member_read" on public.beverages
  for select to authenticated
  using (private.is_workspace_member(workspace_id) or private.is_platform_admin());
create policy "beverages_owner_write" on public.beverages
  for all to authenticated
  using (private.is_workspace_owner(workspace_id) or private.is_platform_admin())
  with check (private.is_workspace_owner(workspace_id) or private.is_platform_admin());

drop policy if exists "service_settings_member_all" on public.service_settings;
create policy "service_settings_member_read" on public.service_settings
  for select to authenticated
  using (private.is_workspace_member(workspace_id) or private.is_platform_admin());
create policy "service_settings_owner_write" on public.service_settings
  for all to authenticated
  using (private.is_workspace_owner(workspace_id) or private.is_platform_admin())
  with check (private.is_workspace_owner(workspace_id) or private.is_platform_admin());
create policy "service_settings_staff_operational_write" on public.service_settings
  for all to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (id in ('service_date', 'kitchen_ticket_order', 'floor_status_v1') or id like 'inventory_device:%')
  )
  with check (
    private.is_workspace_member(workspace_id)
    and (id in ('service_date', 'kitchen_ticket_order', 'floor_status_v1') or id like 'inventory_device:%')
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'service_archive'
     ) then
    alter publication supabase_realtime add table public.service_archive;
  end if;
end
$$;
