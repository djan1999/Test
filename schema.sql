-- ============================================================
-- Milka Service Board — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.
--
-- MULTI-TENANT: every restaurant is an isolated "workspace". Each data table
-- below carries a `workspace_id`, and the live database additionally enforces
-- composite primary keys on the natural-key tables (service_tables,
-- service_settings, menu_courses, wines) plus per-workspace membership policies.
-- Those incremental changes are applied to the live project via tracked Supabase
-- migrations; this file documents the tenancy foundation (the new tables and
-- helper functions) so a fresh project can be bootstrapped.
-- ============================================================

-- ── workspaces / members / platform admins ──────────────────
-- A workspace = one restaurant (kind 'restaurant') or a test/demo copy
-- (kind 'sandbox'). Membership grants access; a platform admin (the master
-- "Demo" account) can reach every workspace.
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

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Security-definer helpers so RLS policies that call them don't recurse through
-- the RLS of the tables they read.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_platform_admin()       from anon, public;
revoke execute on function public.is_workspace_member(uuid) from anon, public;
grant  execute on function public.is_platform_admin()       to authenticated;
grant  execute on function public.is_workspace_member(uuid) to authenticated;

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.platform_admins   enable row level security;

drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read" on public.workspaces
  for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_member(id));

drop policy if exists "members_self_read" on public.workspace_members;
create policy "members_self_read" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform_admins_self_read" on public.platform_admins;
create policy "platform_admins_self_read" on public.platform_admins
  for select to authenticated
  using (user_id = auth.uid());

-- Each data table below also has a per-workspace policy of the form:
--   create policy "<table>_member_all" on public.<table>
--     for all to authenticated
--     using (public.is_workspace_member(workspace_id) or public.is_platform_admin())
--     with check (public.is_workspace_member(workspace_id) or public.is_platform_admin());

-- ── service_tables ──────────────────────────────────────────
create table if not exists public.service_tables (
  table_id integer primary key check (table_id between 1 and 10),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.service_tables enable row level security;

drop policy if exists "service_tables_read" on public.service_tables;
create policy "service_tables_read" on public.service_tables
  for select to anon, authenticated using (true);

drop policy if exists "service_tables_write" on public.service_tables;
create policy "service_tables_write" on public.service_tables
  for insert to anon, authenticated with check (true);

drop policy if exists "service_tables_update" on public.service_tables;
create policy "service_tables_update" on public.service_tables
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "service_tables_delete" on public.service_tables;
create policy "service_tables_delete" on public.service_tables
  for delete to anon, authenticated using (true);

insert into public.service_tables (table_id, data)
select gs, '{}'::jsonb
from generate_series(1, 10) as gs
on conflict (table_id) do nothing;

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
create table if not exists public.service_settings (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.service_settings enable row level security;

drop policy if exists "service_settings_read" on public.service_settings;
create policy "service_settings_read" on public.service_settings
  for select to anon, authenticated using (true);

drop policy if exists "service_settings_write" on public.service_settings;
create policy "service_settings_write" on public.service_settings
  for insert to anon, authenticated with check (true);

drop policy if exists "service_settings_update" on public.service_settings;
create policy "service_settings_update" on public.service_settings
  for update to anon, authenticated using (true) with check (true);

insert into public.service_settings (id, state)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

-- Seed empty Menu Layout Profiles payload so the app has a row to read on first load.
-- The app populates default Long/Short Menu and Long/Short Kitchen profiles
-- from menuCourses on first run.
insert into public.service_settings (id, state)
values ('menu_layout_profiles_v2', '{"profiles":[],"assignments":{"longMenuProfileId":null,"shortMenuProfileId":null,"longKitchenProfileId":null,"shortKitchenProfileId":null},"activeProfileId":null}'::jsonb)
on conflict (id) do nothing;

-- ── service_archive ─────────────────────────────────────────
create table if not exists public.service_archive (
  id uuid primary key default gen_random_uuid(),
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

drop policy if exists "service_archive_read" on public.service_archive;
create policy "service_archive_read" on public.service_archive
  for select to anon, authenticated using (true);

drop policy if exists "service_archive_write" on public.service_archive;
create policy "service_archive_write" on public.service_archive
  for insert to anon, authenticated with check (true);

drop policy if exists "service_archive_update" on public.service_archive;
create policy "service_archive_update" on public.service_archive
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "service_archive_delete" on public.service_archive;
create policy "service_archive_delete" on public.service_archive
  for delete to anon, authenticated using (true);

-- ── menu_courses ─────────────────────────────────────────────
-- This is the authoritative source for all menu data.
-- Courses are managed directly via the Admin panel (no external sync).
create table if not exists public.menu_courses (
  position integer primary key,
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
  updated_at timestamptz not null default now()
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
  add column if not exists is_active boolean not null default true;

alter table public.menu_courses enable row level security;

drop policy if exists "menu_courses_read" on public.menu_courses;
create policy "menu_courses_read" on public.menu_courses
  for select to anon, authenticated using (true);

drop policy if exists "menu_courses_write" on public.menu_courses;
create policy "menu_courses_write" on public.menu_courses
  for insert to anon, authenticated with check (true);

drop policy if exists "menu_courses_update" on public.menu_courses;
create policy "menu_courses_update" on public.menu_courses
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "menu_courses_delete" on public.menu_courses;
create policy "menu_courses_delete" on public.menu_courses
  for delete to anon, authenticated using (true);

-- ── wines ────────────────────────────────────────────────────
create table if not exists public.wines (
  key text primary key,
  producer text not null,
  name text not null,
  wine_name text,
  vintage text not null default 'NV',
  region text,
  country text,
  by_glass boolean not null default false,
  source text not null default 'sync',
  updated_at timestamptz not null default now()
);

-- Migration: add source column if upgrading an existing table
alter table public.wines
  add column if not exists source text not null default 'sync';

create index if not exists wines_source_country_idx
  on public.wines(source, country);

alter table public.wines enable row level security;

drop policy if exists "wines_read" on public.wines;
create policy "wines_read" on public.wines
  for select to anon, authenticated using (true);

drop policy if exists "wines_write" on public.wines;
create policy "wines_write" on public.wines
  for insert to anon, authenticated with check (true);

drop policy if exists "wines_update" on public.wines;
create policy "wines_update" on public.wines
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "wines_delete" on public.wines;
create policy "wines_delete" on public.wines
  for delete to anon, authenticated using (true);

-- ── beverages ────────────────────────────────────────────────
create table if not exists public.beverages (
  id bigint generated always as identity primary key,
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

drop policy if exists "beverages_read" on public.beverages;
create policy "beverages_read" on public.beverages
  for select to anon, authenticated using (true);

drop policy if exists "beverages_write" on public.beverages;
create policy "beverages_write" on public.beverages
  for insert to anon, authenticated with check (true);

drop policy if exists "beverages_update" on public.beverages;
create policy "beverages_update" on public.beverages
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "beverages_delete" on public.beverages;
create policy "beverages_delete" on public.beverages
  for delete to anon, authenticated using (true);

-- ── reservations ─────────────────────────────────────────────
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  table_id integer not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.reservations enable row level security;

drop policy if exists "reservations_read" on public.reservations;
create policy "reservations_read" on public.reservations
  for select to anon, authenticated using (true);

drop policy if exists "reservations_write" on public.reservations;
create policy "reservations_write" on public.reservations
  for insert to anon, authenticated with check (true);

drop policy if exists "reservations_update" on public.reservations;
create policy "reservations_update" on public.reservations
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "reservations_delete" on public.reservations;
create policy "reservations_delete" on public.reservations
  for delete to anon, authenticated using (true);

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
