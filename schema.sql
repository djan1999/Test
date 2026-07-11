-- ============================================================
-- Milka Service Board — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.
--
-- MULTI-TENANT: every restaurant is an isolated "workspace". Each data table
-- below carries a `workspace_id` with composite primary keys on the
-- natural-key tables (service_tables, service_settings, menu_courses, wines)
-- and per-workspace membership RLS policies — this file matches the live
-- database (verified against it on 2026-06-09), so a fresh project
-- bootstrapped from it gets the same tenancy enforcement as production.
-- ============================================================

-- ── workspaces / members ────────────────────────────────────
-- A workspace = one restaurant (kind 'restaurant') or a test/demo copy
-- (kind 'sandbox'). Each login reaches only its explicit membership. Demo is
-- an ordinary sandbox owned by a separate test login.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  kind text not null default 'restaurant' check (kind in ('restaurant','sandbox')),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

-- Security-definer helpers so RLS policies that call them don't recurse through
-- the RLS of the tables they read. They live in a dedicated `private` schema
-- (NOT the PostgREST-exposed `public` schema) so signed-in users cannot invoke
-- them via /rest/v1/rpc/; `authenticated` still gets USAGE + EXECUTE so RLS
-- policy evaluation can call them (Supabase advisor lint 0029).
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

revoke execute on function private.is_workspace_member(uuid) from anon, public;
grant  execute on function private.is_workspace_member(uuid) to authenticated;

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read" on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id));

-- auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once per
-- query instead of once per row (Supabase lint 0003_auth_rls_initplan).
drop policy if exists "members_self_read" on public.workspace_members;
create policy "members_self_read" on public.workspace_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Each data table below also has a per-workspace policy of the form:
--   create policy "<table>_member_all" on public.<table>
--     for all to authenticated
--     using (private.is_workspace_member(workspace_id))
--     with check (private.is_workspace_member(workspace_id));

-- ── service_tables ──────────────────────────────────────────
-- One row per (workspace, table 1-10). The app upserts the ten rows for a
-- workspace on first use, so no global seed is needed here.
create table if not exists public.service_tables (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  table_id integer not null check (table_id between 1 and 10),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, table_id)
);

alter table public.service_tables enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "service_tables_read" on public.service_tables;
drop policy if exists "service_tables_write" on public.service_tables;
drop policy if exists "service_tables_update" on public.service_tables;
drop policy if exists "service_tables_delete" on public.service_tables;

drop policy if exists "service_tables_member_all" on public.service_tables;
create policy "service_tables_member_all" on public.service_tables
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── service_settings ────────────────────────────────────────
-- Generic key/value JSON store. Notable rows used by the app:
--   id = "menu_layout_profiles_v2" → unified layout profiles. Shape:
--     { profiles: [{ id, name, target: "guest_menu"|"kitchen_flow",
--                    menuTemplate, layoutStyles }],
--       assignments: { longMenuProfileId, shortMenuProfileId,
--                      longKitchenProfileId, shortKitchenProfileId },
--       activeProfileId }
--     This is the single source of truth for menu layouts. Long Menu / Short
--     Menu / Long Kitchen / Short Kitchen each pick a profile by id.
--   id = "menu_layout_profiles_v1" → legacy multi-profile wrapper (auto-migrated to v2)
--   id = "menu_layout_v2"          → legacy single-profile menuTemplate (auto-migrated to v2)
--   id = "menu_layout_global"      → legacy single-profile layoutStyles (auto-migrated to v2)
--   id = "menu_gen_rules"          → generator behaviour flags
--   id = "menu_gen_team"           → team names
--   id = "menu_gen_title"          → menu title (per-language)
--   id = "menu_gen_thankyou"       → thank-you note (per-language)
--   id = "quick_access"            → quick-access items
--
-- The flat `menu_layouts_v1` row from a previous design pass is intentionally
-- not read by the current app. It can be left in place; the row-based
-- menuTemplate is the only guest layout system.
-- Rows are created per workspace by the app on first use (no global seed).
create table if not exists public.service_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

alter table public.service_settings enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "service_settings_read" on public.service_settings;
drop policy if exists "service_settings_write" on public.service_settings;
drop policy if exists "service_settings_update" on public.service_settings;

drop policy if exists "service_settings_member_all" on public.service_settings;
create policy "service_settings_member_all" on public.service_settings
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── service_archive ─────────────────────────────────────────
create table if not exists public.service_archive (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  label text not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz default null
);

-- Migration: add deleted_at to existing service_archive tables
alter table public.service_archive
  add column if not exists deleted_at timestamptz default null;

alter table public.service_archive enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "service_archive_read" on public.service_archive;
drop policy if exists "service_archive_write" on public.service_archive;
drop policy if exists "service_archive_update" on public.service_archive;
drop policy if exists "service_archive_delete" on public.service_archive;

drop policy if exists "service_archive_member_all" on public.service_archive;
create policy "service_archive_member_all" on public.service_archive
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── menu_courses ─────────────────────────────────────────────
-- This is the authoritative source for all menu data.
-- Courses are managed directly via the Admin panel (no external sync).
create table if not exists public.menu_courses (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  position integer not null,
  menu jsonb,                              -- {name, sub} EN dish
  menu_si jsonb,                           -- {name, sub} SI dish
  -- Dietary restriction substitutes (each is {name, sub} or null)
  veg jsonb,
  vegan jsonb,
  pescetarian jsonb,
  gluten_free jsonb,
  dairy_free jsonb,
  nut_free jsonb,
  shellfish_free jsonb,
  no_red_meat jsonb,
  no_pork jsonb,
  no_game jsonb,
  no_offal jsonb,
  egg_free jsonb,
  no_alcohol jsonb,
  no_garlic_onion jsonb,
  halal jsonb,
  low_fodmap jsonb,
  -- SI restriction substitutes + notes (keyed JSON blob)
  restrictions_si jsonb,
  -- Pairings (each is {name, sub} or null)
  wp jsonb,                                -- Wine pairing
  wp_si jsonb,
  na jsonb,                                -- Non-alcoholic pairing
  na_si jsonb,
  os jsonb,                                -- Our Story pairing
  os_si jsonb,
  premium jsonb,                           -- Premium pairing
  premium_si jsonb,
  -- Legacy forced pairing override (deprecated; replaced by optional_pairing block config)
  force_pairing_title text not null default '',
  force_pairing_sub text not null default '',
  force_pairing_title_si text not null default '',
  force_pairing_sub_si text not null default '',
  -- Metadata
  hazards jsonb,
  is_snack boolean not null default false,
  -- LAST BITE: firing this course arms a terrace party's move (one per menu;
  -- see docs/TERRACE_FLOW_PLAN.md). Uniqueness is enforced app-side.
  is_last_bite boolean not null default false,
  course_key text not null default '',
  course_category text not null default 'main',
  optional_flag text not null default '',
  optional_pairing_flag text not null default '',
  optional_pairing_label text not null default '',
  optional_pairing_enabled boolean not null default false,
  optional_pairing_default_on boolean not null default true,
  optional_pairing_alco jsonb,
  optional_pairing_alco_si jsonb,
  optional_pairing_na jsonb,
  optional_pairing_na_si jsonb,
  section_gap_before boolean not null default false,
  show_on_short boolean not null default false,
  short_order integer,
  kitchen_note text not null default '',
  aperitif_btn text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, position)
);

-- Migration: add columns if upgrading an existing table
alter table public.menu_courses
  add column if not exists menu_si jsonb,
  add column if not exists wp_si jsonb,
  add column if not exists na_si jsonb,
  add column if not exists os_si jsonb,
  add column if not exists premium_si jsonb,
  add column if not exists restrictions_si jsonb,
  add column if not exists course_key text not null default '',
  add column if not exists course_category text not null default 'main',
  add column if not exists optional_flag text not null default '',
  add column if not exists optional_pairing_flag text not null default '',
  add column if not exists optional_pairing_label text not null default '',
  add column if not exists optional_pairing_enabled boolean not null default false,
  add column if not exists optional_pairing_default_on boolean not null default true,
  add column if not exists optional_pairing_alco jsonb,
  add column if not exists optional_pairing_alco_si jsonb,
  add column if not exists optional_pairing_na jsonb,
  add column if not exists optional_pairing_na_si jsonb,
  add column if not exists section_gap_before boolean not null default false,
  add column if not exists show_on_short boolean not null default false,
  add column if not exists short_order integer,
  add column if not exists force_pairing_title text not null default '',
  add column if not exists force_pairing_sub text not null default '',
  add column if not exists force_pairing_title_si text not null default '',
  add column if not exists force_pairing_sub_si text not null default '',
  add column if not exists kitchen_note text not null default '',
  add column if not exists vegan jsonb,
  add column if not exists shellfish_free jsonb,
  add column if not exists no_alcohol jsonb,
  add column if not exists no_garlic_onion jsonb,
  add column if not exists halal jsonb,
  add column if not exists low_fodmap jsonb,
  add column if not exists aperitif_btn text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_last_bite boolean not null default false;

alter table public.menu_courses enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "menu_courses_read" on public.menu_courses;
drop policy if exists "menu_courses_write" on public.menu_courses;
drop policy if exists "menu_courses_update" on public.menu_courses;
drop policy if exists "menu_courses_delete" on public.menu_courses;

drop policy if exists "menu_courses_member_all" on public.menu_courses;
create policy "menu_courses_member_all" on public.menu_courses
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── wines ────────────────────────────────────────────────────
create table if not exists public.wines (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  producer text not null,
  name text not null,
  wine_name text,
  vintage text not null default 'NV',
  region text,
  country text,
  by_glass boolean not null default false,
  source text not null default 'sync',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

-- Migration: add source column if upgrading an existing table
alter table public.wines
  add column if not exists source text not null default 'sync';

create index if not exists wines_source_country_idx
  on public.wines(source, country);

alter table public.wines enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "wines_read" on public.wines;
drop policy if exists "wines_write" on public.wines;
drop policy if exists "wines_update" on public.wines;
drop policy if exists "wines_delete" on public.wines;

drop policy if exists "wines_member_all" on public.wines;
create policy "wines_member_all" on public.wines
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── beverages ────────────────────────────────────────────────
create table if not exists public.beverages (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null,
  name text not null,
  notes text not null default '',
  position integer not null default 0,
  source text not null default 'manual',
  updated_at timestamptz not null default now()
);

-- Migration: add source column if upgrading an existing table
alter table public.beverages
  add column if not exists source text not null default 'manual';

create index if not exists beverages_source_category_idx
  on public.beverages(source, category);

alter table public.beverages enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "beverages_read" on public.beverages;
drop policy if exists "beverages_write" on public.beverages;
drop policy if exists "beverages_update" on public.beverages;
drop policy if exists "beverages_delete" on public.beverages;

drop policy if exists "beverages_member_all" on public.beverages;
create policy "beverages_member_all" on public.beverages
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- ── reservations ─────────────────────────────────────────────
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  table_id integer not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.reservations enable row level security;

-- Drop the pre-tenancy open policies if upgrading an old project.
drop policy if exists "reservations_read" on public.reservations;
drop policy if exists "reservations_write" on public.reservations;
drop policy if exists "reservations_update" on public.reservations;

drop policy if exists "reservations_member_all" on public.reservations;
create policy "reservations_member_all" on public.reservations
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- Legacy open delete policy (`for delete to anon, authenticated using (true)`)
-- is intentionally NOT recreated: OR-combined with reservations_member_all it
-- let any authenticated user delete ANY workspace's reservations. Drop it on
-- upgrade so deletes are governed solely by reservations_member_all above
-- (workspace members only).
drop policy if exists "reservations_delete" on public.reservations;

-- ── Realtime ─────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'public.service_tables',
    'public.service_settings',
    'public.menu_courses',
    'public.wines',
    'public.beverages',
    'public.reservations'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname || '.' || tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %s', t);
    end if;
  end loop;
end $$;

-- ── Realtime hardening / atomic catalog replacement ─────────
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

-- Identity-checked finish (11.07): the clear names WHICH service it ends.
-- Passing p_expected_started_at / p_expected_date makes the whole call a
-- NO-OP with {superseded:true} when the store no longer holds that service
-- — a stale device can never blank a freshly started one. The guard lives
-- in the UPDATE's WHERE clause, re-evaluated on the row's current version,
-- so it is atomic against a concurrent start. Identity-less calls keep the
-- legacy unconditional behavior.
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
         (p_expected_started_at is null or state->>'startedAt' = p_expected_started_at)
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

  insert into public.service_tables(workspace_id, table_id, data, updated_at)
  select p_workspace_id, table_id, '{}'::jsonb, clock_timestamp()
  from generate_series(1, 10) as table_id
  on conflict (workspace_id, table_id)
  do update set data = '{}'::jsonb, updated_at = excluded.updated_at;

  return jsonb_build_object('superseded', false);
end;
$$;

revoke all on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  from public, anon;
grant execute on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  to authenticated, service_role;

-- Realtime DELETE events carry only the old row; the workspace_id channel
-- filter needs it, so PK-only replica identity silently dropped deletes for
-- fallback devices.
alter table public.reservations replica identity full;


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

-- PowerSync must receive both the workspace membership lookup and every table
-- referenced by the deployed sync streams. Keep this idempotent so a project
-- can be reconstructed from the repository instead of dashboard memory.
do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    execute 'create publication powersync';
  end if;

  foreach table_name in array array[
    'workspace_members',
    'service_tables',
    'reservations',
    'service_settings',
    'menu_courses',
    'beverages',
    'wines',
    'service_archive'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication powersync add table public.%I', table_name);
    end if;
  end loop;
end
$$;
