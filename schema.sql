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
-- ── services ────────────────────────────────────────────────
-- THE service lifecycle: every service is its own row. START = insert a new
-- row (creates a fresh board namespace — clears nothing). END = flip that one
-- row to status='ended' (idempotent, destroys nothing — the ended service IS
-- the archive). A stale device can only ever end the old service it knows;
-- "blank the board" does not exist as an operation in this model.
create table if not exists public.services (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  session text not null default 'dinner' check (session in ('lunch','dinner')),
  chosen_on date,
  started_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live','ended')),
  ended_at timestamptz,
  end_reason text,
  label text,
  snapshot jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists services_workspace_status_idx
  on public.services(workspace_id, status);
create index if not exists services_workspace_date_idx
  on public.services(workspace_id, date desc, started_at desc);

alter table public.services enable row level security;

-- Per-command policies: members read and write, but DELETE is allowed ONLY
-- for archive-trash purge — an ENDED service that is already soft-deleted
-- (double-confirmed destruction, mirroring the legacy archive purge). A LIVE
-- service can never be deleted through any path. (Deliberately NOT `for all`:
-- policies OR together per command, and an all-policy would re-grant delete
-- on live rows.)
drop policy if exists "services_member_select" on public.services;
create policy "services_member_select" on public.services
  for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists "services_member_insert" on public.services;
create policy "services_member_insert" on public.services
  for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
drop policy if exists "services_member_update" on public.services;
create policy "services_member_update" on public.services
  for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));
drop policy if exists "services_purge_trash_only" on public.services;
create policy "services_purge_trash_only" on public.services
  for delete to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and status = 'ended'
    and deleted_at is not null
  );
revoke all on table public.services from anon;
grant select, insert, update, delete on table public.services to authenticated;
grant all on table public.services to service_role;

-- Single-live-service invariant: a row going live ends every OTHER live
-- service in the workspace (non-destructively). Newest started_at wins, so an
-- offline device uploading an hours-old start cannot supersede the genuinely
-- newer live service — the stale row is ended instead.
create or replace function private.services_single_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'live' then
    return new;
  end if;
  if exists (
    select 1 from public.services
     where workspace_id = new.workspace_id
       and status = 'live'
       and id <> new.id
       and started_at > new.started_at
  ) then
    update public.services
       set status = 'ended',
           ended_at = clock_timestamp(),
           end_reason = coalesce(end_reason, 'superseded'),
           updated_at = clock_timestamp()
     where id = new.id;
  else
    update public.services
       set status = 'ended',
           ended_at = clock_timestamp(),
           end_reason = coalesce(end_reason, 'superseded'),
           updated_at = clock_timestamp()
     where workspace_id = new.workspace_id
       and status = 'live'
       and id <> new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.services_single_live() from public, anon, authenticated;

drop trigger if exists services_single_live on public.services;
create trigger services_single_live
after insert or update of status on public.services
for each row execute function private.services_single_live();

-- One row per configured workspace table. The app creates rows from the
-- restaurant configuration, so no global seed is needed here.
-- Every board row belongs to ONE service (see public.services above). A blank
-- table is the ABSENCE of a row — nothing ever writes empty rows, and ending a
-- service touches no row here at all. That is the wipe-proofing: no operation
-- in the system can blank another service's board.
create table if not exists public.service_tables (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  table_id integer not null check (table_id between 1 and 999),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, service_id, table_id)
);
create index if not exists service_tables_service_idx
  on public.service_tables(service_id);

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

-- Legacy signature (pre-entity builds): fails loudly. After the entity
-- migration a write without a service_id cannot name which service's row it
-- means; guessing would be how wipes happen. Old devices surface a sync-error
-- and keep their data locally until they are updated.
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
begin
  raise exception 'save_service_table_if_current now requires p_service_id — update the app (service entity lifecycle release)';
end;
$$;

create or replace function public.save_service_table_if_current(
  p_workspace_id uuid,
  p_service_id uuid,
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
  if p_workspace_id is null or p_service_id is null then
    raise exception 'workspace_id and service_id are required';
  end if;
  if p_expected_updated_at is null then
    insert into public.service_tables(workspace_id, service_id, table_id, data, updated_at)
    values (p_workspace_id, p_service_id, p_table_id, coalesce(p_data, '{}'::jsonb), p_updated_at)
    on conflict (workspace_id, service_id, table_id) do nothing;
  else
    update public.service_tables
       set data = coalesce(p_data, '{}'::jsonb), updated_at = p_updated_at
     where workspace_id = p_workspace_id
       and service_id = p_service_id
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
revoke all on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;

-- Version-checked writes for shared service_settings documents.
--
-- The floor-map and floor-status rows are edited by several devices. A plain
-- upsert is last-writer-wins: even after the client performs a three-way merge,
-- another device can save between its read and write and still be erased.
-- This compare-and-swap function changes the row only while updated_at still
-- matches the version the client merged against. The client retries and folds
-- again when another writer wins first.
create or replace function public.save_service_setting_if_current(
  p_workspace_id uuid,
  p_id text,
  p_expected_updated_at timestamptz,
  p_state jsonb,
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
  if p_workspace_id is null or nullif(p_id, '') is null then
    raise exception 'workspace_id and setting id are required';
  end if;

  if p_expected_updated_at is null then
    insert into public.service_settings(workspace_id, id, state, updated_at)
    values (
      p_workspace_id,
      p_id,
      coalesce(p_state, '{}'::jsonb),
      coalesce(p_updated_at, clock_timestamp())
    )
    on conflict (workspace_id, id) do nothing;
  else
    update public.service_settings as setting
       set state = coalesce(p_state, '{}'::jsonb),
           updated_at = coalesce(p_updated_at, clock_timestamp())
     where setting.workspace_id = p_workspace_id
       and setting.id = p_id
       and setting.updated_at = p_expected_updated_at;
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_service_setting_if_current(uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_setting_if_current(uuid, text, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;
-- Reservation compare-and-swap without adding an updated_at column. The full
-- previous date/table/data tuple is the version token.
create or replace function public.save_reservation_if_current(
  p_workspace_id uuid,
  p_id uuid,
  p_expected_date date,
  p_expected_table_id integer,
  p_expected_data jsonb,
  p_date date,
  p_table_id integer,
  p_data jsonb,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer := 0;
begin
  if p_workspace_id is null or p_id is null then
    raise exception 'workspace_id and reservation id are required';
  end if;
  if p_date is null or p_table_id is null then
    raise exception 'reservation date and table_id are required';
  end if;

  if p_expected_date is null then
    insert into public.reservations(id, workspace_id, date, table_id, data, created_at)
    values (
      p_id,
      p_workspace_id,
      p_date,
      p_table_id,
      coalesce(p_data, '{}'::jsonb),
      coalesce(p_created_at, clock_timestamp())
    )
    on conflict (id) do nothing;
  else
    update public.reservations as reservation
       set date = p_date,
           table_id = p_table_id,
           data = coalesce(p_data, '{}'::jsonb)
     where reservation.id = p_id
       and reservation.workspace_id = p_workspace_id
       and reservation.date is not distinct from p_expected_date
       and reservation.table_id is not distinct from p_expected_table_id
       and reservation.data is not distinct from coalesce(p_expected_data, '{}'::jsonb);
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_reservation_if_current(
  uuid, uuid, date, integer, jsonb, date, integer, jsonb, timestamptz
) from public, anon;
grant execute on function public.save_reservation_if_current(
  uuid, uuid, date, integer, jsonb, date, integer, jsonb, timestamptz
) to authenticated, service_role;


-- (The legacy archive_and_finish_service function is defined at the end of
-- this file as a NEUTERED straggler shield — see the service entity lifecycle
-- section. It can file an archive snapshot but can never blank the board.)

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
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'services'
     ) then
    alter publication supabase_realtime add table public.services;
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
    'services',
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

-- NEUTERED straggler shield (service entity lifecycle release). A device
-- still running a pre-entity build (stale PWA cache, old dev checkout) may
-- replay a queued END SERVICE through this function — possibly UNGUARDED.
-- It must never again be able to blank the board:
--   • the archive snapshot it carries is still filed (a genuine record of the
--     OLD service that device saw),
--   • the legacy service_date pointer is cleared only when the guard matches,
--   • service_tables are NEVER touched — the blanking UPDATE is gone.
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

  if p_archive_id is not null and p_archive_date is not null and nullif(p_archive_label, '') is not null then
    insert into public.service_archive(
      id, workspace_id, date, label, state, created_at, deleted_at
    )
    values (
      p_archive_id, p_workspace_id, p_archive_date, p_archive_label,
      coalesce(p_archive_state, '{}'::jsonb), clock_timestamp(), null
    )
    on conflict (id) do nothing;
  end if;

  if guarded then
    update public.service_settings
       set state = '{}'::jsonb, updated_at = clock_timestamp()
     where workspace_id = p_workspace_id
       and id = 'service_date'
       and (p_expected_started_at is null
             or state->>'startedAt' is null
             or state->>'startedAt' = p_expected_started_at)
       and (p_expected_date is null or state->>'date' = p_expected_date);
    get diagnostics cleared = row_count;
    if cleared = 0 then
      return jsonb_build_object('superseded', true);
    end if;
    return jsonb_build_object('superseded', false);
  end if;

  -- Unguarded legacy call: refuse. It cannot name which service it is ending,
  -- so it may not end anything. (Pre-entity builds treat superseded as
  -- "adopt the live state and move on" — exactly right here.)
  return jsonb_build_object('superseded', true);
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

-- Final pilot-readiness hardening layer (04.08.2026). Keep this at the end
-- so fresh bootstrap and the dated migration converge to the same contract.
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

-- On a replay the composite FK below already exists and depends on the UNIQUE
-- constraint, which would make the next drop fail; release the FK first — it
-- is recreated a few statements later, so the end state is unchanged.
alter table public.service_tables
  drop constraint if exists service_tables_workspace_service_fk;

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
