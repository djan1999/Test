create table if not exists public.service_tables (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.service_tables enable row level security;

drop policy if exists "service_tables_read" on public.service_tables;
create policy "service_tables_read"
on public.service_tables
for select
to anon, authenticated
using (true);

drop policy if exists "service_tables_write" on public.service_tables;
create policy "service_tables_write"
on public.service_tables
for insert
to anon, authenticated
with check (true);

drop policy if exists "service_tables_update" on public.service_tables;
create policy "service_tables_update"
on public.service_tables
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "service_tables_delete" on public.service_tables;
create policy "service_tables_delete"
on public.service_tables
for delete
to anon, authenticated
using (true);

insert into public.service_tables (id, state)
values
  ('t1', '{}'::jsonb),
  ('t2', '{}'::jsonb),
  ('t3', '{}'::jsonb),
  ('t4', '{}'::jsonb),
  ('t5', '{}'::jsonb),
  ('t6', '{}'::jsonb),
  ('t7', '{}'::jsonb),
  ('t8', '{}'::jsonb),
  ('t9', '{}'::jsonb),
  ('t10', '{}'::jsonb)
on conflict (id) do nothing;

create table if not exists public.service_settings (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.service_settings enable row level security;

drop policy if exists "service_settings_read" on public.service_settings;
create policy "service_settings_read"
on public.service_settings
for select
to anon, authenticated
using (true);

drop policy if exists "service_settings_write" on public.service_settings;
create policy "service_settings_write"
on public.service_settings
for insert
to anon, authenticated
with check (true);

drop policy if exists "service_settings_update" on public.service_settings;
create policy "service_settings_update"
on public.service_settings
for update
to anon, authenticated
using (true)
with check (true);

insert into public.service_settings (id, state)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

alter publication supabase_realtime add table public.service_tables;
alter publication supabase_realtime add table public.service_settings;
