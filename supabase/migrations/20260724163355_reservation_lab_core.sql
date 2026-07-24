-- Milka Reservations LAB.
-- Reservation-owned schema only: no Service, KDS, floor, service_settings,
-- existing reservations, or PowerSync object is changed by this migration.

create table if not exists public.reservation_config (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.reservation_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service text not null check (service ~ '^[a-z][a-z0-9_-]{1,31}$'),
  weekday smallint not null check (weekday between 0 and 6),
  enabled boolean not null default true,
  first_seating time not null,
  last_seating time not null,
  interval_min integer not null default 30 check (interval_min in (15, 30, 45, 60)),
  online_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (workspace_id, service, weekday),
  check (last_seating >= first_seating)
);

create table if not exists public.reservation_calendar_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('closed', 'private_event', 'capacity_override', 'service_override')),
  service text,
  mode text check (mode is null or mode in ('on', 'off')),
  first_seating time,
  last_seating time,
  interval_min integer check (interval_min is null or interval_min in (15, 30, 45, 60)),
  online_off boolean not null default false,
  capacity integer check (capacity is null or capacity > 0),
  label text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, date, kind, service),
  check (
    kind <> 'service_override'
    or (service is not null and mode is not null)
  )
);

create table if not exists public.reservation_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  service text not null,
  booking_time time not null,
  pax integer not null check (pax between 1 and 30),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show')),
  guest_name text not null,
  phone text,
  email text,
  language text not null default 'en',
  source text not null default 'staff'
    check (source in ('staff', 'web', 'phone', 'walk_in', 'waitlist')),
  ref text not null,
  table_label text,
  experience text,
  occasion text,
  notes text,
  allergies jsonb not null default '[]'::jsonb,
  accessibility jsonb not null default '[]'::jsonb,
  consent_news boolean not null default false,
  idempotency_key text,
  created_by text not null default 'SYSTEM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, ref),
  unique (workspace_id, idempotency_key)
);

create table if not exists public.reservation_guests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name_key text not null,
  name text not null,
  phone text,
  email text,
  language text,
  notes text,
  tags jsonb not null default '[]'::jsonb,
  visit_count integer not null default 0 check (visit_count >= 0),
  last_visit date,
  merged_into uuid references public.reservation_guests(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name_key)
);

create table if not exists public.reservation_waitlist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  service text,
  requested_time time,
  time_window text,
  guest_name text not null,
  phone text,
  email text,
  pax integer not null check (pax between 1 and 30),
  quoted_minutes integer check (quoted_minutes is null or quoted_minutes >= 0),
  notes text,
  restrictions jsonb not null default '[]'::jsonb,
  source text not null default 'staff',
  status text not null default 'waiting'
    check (status in ('waiting', 'contacted', 'converted', 'removed', 'expired')),
  converted_booking_id uuid references public.reservation_bookings(id),
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservation_status_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_id uuid not null references public.reservation_bookings(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor text not null,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  note text
);

create table if not exists public.reservation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_id uuid not null references public.reservation_bookings(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null check (channel in ('email', 'sms', 'phone', 'internal')),
  template text not null,
  state text not null check (state in ('draft', 'not_configured', 'queued', 'sent', 'failed')),
  body text
);

create table if not exists public.reservation_admin_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor text not null,
  section text not null,
  field text not null,
  old_value jsonb,
  new_value jsonb
);

create table if not exists public.reservation_manage_tokens (
  token_hash text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_id uuid not null references public.reservation_bookings(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists reservation_bookings_day_idx
  on public.reservation_bookings (workspace_id, date, service, booking_time);
create index if not exists reservation_bookings_guest_idx
  on public.reservation_bookings (workspace_id, lower(guest_name), date desc);
create index if not exists reservation_calendar_rules_day_idx
  on public.reservation_calendar_rules (workspace_id, date);
create index if not exists reservation_waitlist_active_idx
  on public.reservation_waitlist (workspace_id, date, status, created_at);
create index if not exists reservation_status_events_booking_idx
  on public.reservation_status_events (workspace_id, booking_id, occurred_at);
create index if not exists reservation_guests_name_idx
  on public.reservation_guests (workspace_id, name_key);
create index if not exists reservation_manage_tokens_booking_idx
  on public.reservation_manage_tokens (workspace_id, booking_id);

alter table public.reservation_config enable row level security;
alter table public.reservation_services enable row level security;
alter table public.reservation_calendar_rules enable row level security;
alter table public.reservation_bookings enable row level security;
alter table public.reservation_guests enable row level security;
alter table public.reservation_waitlist enable row level security;
alter table public.reservation_status_events enable row level security;
alter table public.reservation_messages enable row level security;
alter table public.reservation_admin_audit enable row level security;
alter table public.reservation_manage_tokens enable row level security;

-- All LAB access passes through reviewed server functions. Nothing is exposed
-- directly to browser roles, even if the project's Data API defaults are open.
revoke all on table
  public.reservation_config,
  public.reservation_services,
  public.reservation_calendar_rules,
  public.reservation_bookings,
  public.reservation_guests,
  public.reservation_waitlist,
  public.reservation_status_events,
  public.reservation_messages,
  public.reservation_admin_audit,
  public.reservation_manage_tokens
from anon, authenticated;

grant all on table
  public.reservation_config,
  public.reservation_services,
  public.reservation_calendar_rules,
  public.reservation_bookings,
  public.reservation_guests,
  public.reservation_waitlist,
  public.reservation_status_events,
  public.reservation_messages,
  public.reservation_admin_audit,
  public.reservation_manage_tokens
to service_role;

insert into public.reservation_config (workspace_id, config)
select id, '{
  "restaurantName":"Milka",
  "tagline":"A table at Milka",
  "timezone":"Europe/Ljubljana",
  "online":{"enabled":true,"maxPax":6,"leadMinutes":30,"windowDays":90,"autoConfirmMaxPax":4,"whenFull":"waitlist"},
  "pacing":{"coversPerSlot":12,"coversPerService":44},
  "durations":{"small":120,"medium":150,"large":180,"buffer":15},
  "tables":[
    {"id":"T01","seats":2},{"id":"T02","seats":2},{"id":"T03","seats":2},
    {"id":"T04","seats":4},{"id":"T05","seats":4},{"id":"T06","seats":4},
    {"id":"T07","seats":6},{"id":"T08","seats":8}
  ],
  "publicPage":{"phone":"+386 40 000 000","languages":["en","sl"],"policies":"Please tell us about allergies and accessibility needs before your visit."},
  "waitlist":{"enabled":true,"defaultQuoteMinutes":30,"autoSuggest":true},
  "privacy":{"retentionMonths":24}
}'::jsonb
from public.workspaces
where slug = 'milka-reservations-lab'
on conflict (workspace_id) do nothing;

insert into public.reservation_services
  (workspace_id, service, weekday, enabled, first_seating, last_seating, interval_min, online_enabled)
select workspace.id, schedule.service, schedule.weekday, true,
  schedule.first_seating::time, schedule.last_seating::time, 30, true
from public.workspaces workspace
cross join (values
  ('dinner', 0, '18:00', '19:30'),
  ('dinner', 2, '18:00', '19:30'),
  ('dinner', 3, '18:00', '19:30'),
  ('dinner', 4, '18:00', '19:30'),
  ('dinner', 5, '18:00', '20:00'),
  ('dinner', 6, '18:00', '20:00'),
  ('lunch', 2, '12:00', '13:30'),
  ('lunch', 3, '12:00', '13:30'),
  ('lunch', 4, '12:00', '13:30'),
  ('lunch', 5, '12:00', '13:30')
) as schedule(service, weekday, first_seating, last_seating)
where workspace.slug = 'milka-reservations-lab'
on conflict (workspace_id, service, weekday) do nothing;
