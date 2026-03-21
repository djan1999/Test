-- ============================================================
-- Milka Service Board — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.
-- ============================================================

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
create table if not exists public.menu_courses (
  position integer primary key,
  menu jsonb,
  veg jsonb,
  hazards jsonb,
  na jsonb,
  wp jsonb,
  os jsonb,
  premium jsonb,
  is_snack boolean not null default false,
  gluten_free jsonb,
  dairy_free jsonb,
  nut_free jsonb,
  pescetarian jsonb,
  no_red_meat jsonb,
  no_pork jsonb,
  no_game jsonb,
  no_offal jsonb,
  egg_free jsonb,
  -- Slovenian dish name (for SLO menu generator)
  menu_si jsonb,
  -- Slovenian pairing drink variants (line 2 of bilingual sheet cells)
  wp_si jsonb,
  na_si jsonb,
  os_si jsonb,
  premium_si jsonb,
  -- Slovenian restriction substitutes (keyed by restriction name, e.g. {"veg": {name, sub}})
  restrictions_si jsonb,
  -- Kitchen / display metadata
  course_key text not null default '',
  optional_flag text not null default '',
  section_gap_before boolean not null default false,
  show_on_short boolean not null default false,
  short_order integer,
  force_pairing_title text not null default '',
  force_pairing_sub text not null default '',
  force_pairing_title_si text not null default '',
  force_pairing_sub_si text not null default '',
  kitchen_note text not null default '',
  updated_at timestamptz not null default now()
);

-- Migration: add new columns if upgrading an existing table
alter table public.menu_courses
  add column if not exists menu_si jsonb,
  add column if not exists wp_si jsonb,
  add column if not exists na_si jsonb,
  add column if not exists os_si jsonb,
  add column if not exists premium_si jsonb,
  add column if not exists restrictions_si jsonb,
  add column if not exists course_key text not null default '',
  add column if not exists optional_flag text not null default '',
  add column if not exists section_gap_before boolean not null default false,
  add column if not exists show_on_short boolean not null default false,
  add column if not exists short_order integer,
  add column if not exists force_pairing_title text not null default '',
  add column if not exists force_pairing_sub text not null default '',
  add column if not exists force_pairing_title_si text not null default '',
  add column if not exists force_pairing_sub_si text not null default '',
  add column if not exists kitchen_note text not null default '';

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
  updated_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now()
);

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
    'public.beverages'
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
