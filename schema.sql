create table if not exists public.service_tables (
  table_id integer primary key check (table_id between 1 and 10),
  data jsonb not null default '{}'::jsonb,
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

insert into public.service_tables (table_id, data)
select gs, '{}'::jsonb
from generate_series(1, 10) as gs
on conflict (table_id) do nothing;

alter publication supabase_realtime add table public.service_tables;
