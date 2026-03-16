-- ============================================================
-- Milka Service Board — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.
-- ============================================================

-- ── service_tables ──────────────────────────────────────────
create table if not exists public.service_tables (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
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

insert into public.service_tables (id, state)
values
  ('t1', '{}'::jsonb), ('t2', '{}'::jsonb), ('t3', '{}'::jsonb),
  ('t4', '{}'::jsonb), ('t5', '{}'::jsonb), ('t6', '{}'::jsonb),
  ('t7', '{}'::jsonb), ('t8', '{}'::jsonb), ('t9', '{}'::jsonb),
  ('t10', '{}'::jsonb)
on conflict (id) do nothing;

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
  created_at timestamptz not null default now()
);

alter table public.service_archive enable row level security;

drop policy if exists "service_archive_read" on public.service_archive;
create policy "service_archive_read" on public.service_archive
  for select to anon, authenticated using (true);

drop policy if exists "service_archive_write" on public.service_archive;
create policy "service_archive_write" on public.service_archive
  for insert to anon, authenticated with check (true);

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
  updated_at timestamptz not null default now()
);

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
