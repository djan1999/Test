-- Reservations v2 replacement schema (LAB / staging only).
--
-- reservation_bookings is the only authoritative reservation source. The
-- existing reservations table is retained only as a compatibility read model
-- for the current Service/Floor/Kitchen consumers while the LAB is evaluated.
-- This migration is additive and does not alter any Service-owned table.

begin;

alter table public.reservation_bookings
  add column if not exists operational_data jsonb not null default '{}'::jsonb;

alter table public.reservation_services
  add column if not exists walkins_enabled boolean not null default true,
  add column if not exists min_pax integer
    check (min_pax is null or min_pax between 1 and 30),
  add column if not exists max_pax integer
    check (max_pax is null or max_pax between 1 and 30);

create table if not exists public.reservation_capacity_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date,
  weekday smallint check (weekday between 0 and 6),
  service text,
  seating time,
  covers_cap integer not null check (covers_cap >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (date is not null or weekday is not null)
);

create index if not exists reservation_capacity_rules_lookup_idx
  on public.reservation_capacity_rules (workspace_id, date, service, seating);

create index if not exists reservation_bookings_operational_data_idx
  on public.reservation_bookings using gin (operational_data);

alter table public.reservation_capacity_rules enable row level security;
revoke all on table public.reservation_capacity_rules from anon, authenticated;
grant all on table public.reservation_capacity_rules to service_role;

commit;
