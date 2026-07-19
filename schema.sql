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
  role text not null default 'service' check (role in ('admin','service','kitchen')),
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
returns boolean language sql stable security definer set search_path = '' as $$
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
-- One row per configured workspace table. The app creates rows from the
-- restaurant configuration, so no global seed is needed here.
create table if not exists public.service_tables (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  table_id integer not null check (table_id between 1 and 999),
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

  -- A state with NO startedAt has no identity to mismatch — date decides
  -- (an identity-less live state used to refuse every guarded end forever,
  -- because NULL = '<stamp>' is never true and adoption had nothing to adopt).
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

-- Final architectural-rebuild layer. Keeping this at the end makes the fresh
-- bootstrap converge to the exact same role, table, lifecycle, audit and grant
-- contract as an upgraded project running the dated migration.
-- Architectural rebuild foundations (13.07.2026)
--
-- 1. Replace the legacy owner/staff placeholder with the three operating
--    roles used by the app: admin, service, kitchen.
-- 2. Enforce those roles in Postgres RLS (the UI is convenience; RLS is the
--    actual security boundary).
-- 3. Add an immutable administrative audit trail.
-- 4. Make Data API grants explicit for Supabase's 2026 exposure defaults.

-- â”€â”€ Three-role membership model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Workspace and membership policies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Operational RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Configurable service tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  -- File the archive first: even a superseded finish carries a genuine
  -- snapshot of the service it ended. Deterministic ids dedup double-ends.
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

-- â”€â”€ Administrative audit log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Explicit Data API privileges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- Operational query indexes (13.07.2026). These match the direct-fallback
-- reads used by the service, archive, catalogue, and staff screens.
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
