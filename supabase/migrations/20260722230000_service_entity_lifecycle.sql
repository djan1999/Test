-- ============================================================
-- SERVICE ENTITY LIFECYCLE — the wipe-proof service model.
--
-- Root cause of the 22.07 (and 04.07 / 11.07 / 19.06 / 10.06) incidents:
-- the service lifecycle was mutable shared state — ONE service_date pointer
-- and ONE reusable set of service_tables rows — and "ending a service" was
-- an act of destruction (blank every row, clear the pointer). Any device
-- acting on a stale view (an offline replay, a boot-time auto-end, a skewed
-- clock) could therefore destroy the LIVE service for the whole restaurant.
--
-- New model: every service is its own immutable-identity row in `services`.
--   START  = INSERT a new services row (creates a fresh board namespace —
--            clears nothing, because the new service simply has no rows yet).
--   END    = UPDATE that one row to status='ended' (idempotent, one field,
--            destroys nothing — the ended service IS the archive).
-- Board rows carry the service_id they belong to, so no operation in the
-- system can touch another service's data. A stale device replaying an END
-- can only end the old service it knows — a no-op — and can never blank the
-- board, because "blank the board" no longer exists as an operation.
-- ============================================================

-- ── services ─────────────────────────────────────────────────
create table if not exists public.services (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  date date not null,
  session text not null default 'dinner' check (session in ('lunch','dinner')),
  -- The service day the date was CHOSEN on. A date deliberately picked in the
  -- past (reviewing an old day) is exempt from the rollover auto-end while
  -- chosen_on is still the current service day (mirrors the old semantics).
  chosen_on date,
  started_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live','ended')),
  ended_at timestamptz,
  -- Why the service ended: 'manual' (END SERVICE tap), 'rollover' (auto-end
  -- past the service-day cutoff), 'superseded' (a newer service started),
  -- 'recovered' (migration backfill of an orphaned board).
  end_reason text,
  -- Human archive label ("22. 07. 2026 – DINNER · 2"), stamped at end time.
  label text,
  -- Optional context captured at end (menu courses, beverage lists) so the
  -- archive detail can render exactly what the service used. Never required:
  -- an end with no snapshot still preserves every table row.
  snapshot jsonb,
  -- Archive-view soft delete (mirrors service_archive.deleted_at). The table
  -- rows are retained regardless; delete only hides the entry.
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

-- ── single-live-service invariant ────────────────────────────
-- Starting (or resuming) a service ends every OTHER live service in the
-- workspace — non-destructively (their board rows are untouched forever).
-- Newest started_at wins: an offline device uploading a service it started
-- HOURS ago cannot supersede the genuinely newer live service — the incoming
-- stale row is ended instead, and its own rows survive under its own id.
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
    -- A newer live service already exists: the incoming one lost the race.
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

-- ── service_tables: rows belong to a service ─────────────────
alter table public.service_tables add column if not exists service_id uuid;

-- Backfill: every workspace's CURRENT board becomes the board of a real
-- services row derived from its service_date state (live), or of a synthetic
-- 'recovered' ended service anchored on the rows' own activity when no
-- service_date exists. Blank rows with no service attached are placeholder
-- noise from the old model (the old finish wrote data='{}' to every table) —
-- the new model expresses "blank" as NO row, so they are dropped.
do $$
declare
  ws record;
  st jsonb;
  svc_id uuid;
  svc_date date;
  svc_session text;
  svc_started timestamptz;
  latest timestamptz;
begin
  for ws in (
    select distinct workspace_id as id from public.service_tables where service_id is null
  ) loop
    select state into st
      from public.service_settings
     where workspace_id = ws.id and id = 'service_date';

    svc_date := null;
    if st is not null and (st->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then
      svc_date := (st->>'date')::date;
    end if;

    if svc_date is not null then
      -- A live service exists: it owns the whole current board (blank rows
      -- included — they are that service's empty tables, kept so the live
      -- board carries over 1:1 through the release).
      svc_session := case when st->>'session' in ('lunch','dinner') then st->>'session' else 'dinner' end;
      svc_started := coalesce(nullif(st->>'startedAt','')::timestamptz, now());
      svc_id := gen_random_uuid();
      insert into public.services (id, workspace_id, date, session, chosen_on, started_at, status, updated_at)
      values (
        svc_id, ws.id, svc_date, svc_session,
        case when (st->>'chosenOn') ~ '^\d{4}-\d{2}-\d{2}$' then (st->>'chosenOn')::date else svc_date end,
        svc_started, 'live', clock_timestamp()
      );
      update public.service_tables set service_id = svc_id
       where workspace_id = ws.id and service_id is null;
    else
      -- No live service. Contentful rows are an orphaned board: preserve them
      -- under a synthetic ENDED service dated by their latest activity.
      select max(updated_at) into latest
        from public.service_tables
       where workspace_id = ws.id and service_id is null and data <> '{}'::jsonb;
      if latest is not null then
        svc_id := gen_random_uuid();
        insert into public.services (id, workspace_id, date, session, started_at, status, ended_at, end_reason, label, updated_at)
        values (
          svc_id, ws.id, latest::date, 'dinner', latest, 'ended', clock_timestamp(),
          'recovered', to_char(latest::date, 'DD. MM. YYYY') || ' – RECOVERED', clock_timestamp()
        );
        update public.service_tables set service_id = svc_id
         where workspace_id = ws.id and service_id is null and data <> '{}'::jsonb;
      end if;
      delete from public.service_tables
       where workspace_id = ws.id and service_id is null;
    end if;
  end loop;
end;
$$;

alter table public.service_tables
  alter column service_id set not null;

alter table public.service_tables
  drop constraint if exists service_tables_pkey;
alter table public.service_tables
  add primary key (workspace_id, service_id, table_id);

alter table public.service_tables
  add constraint service_tables_service_fk
  foreign key (service_id) references public.services(id) on delete cascade;

create index if not exists service_tables_service_idx
  on public.service_tables(service_id);

-- Publications: PowerSync replicates `services`; the fallback realtime
-- channel subscribes to it directly.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'powersync' and schemaname = 'public' and tablename = 'services'
    ) then
      alter publication powersync add table public.services;
    end if;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'services'
    ) then
      alter publication supabase_realtime add table public.services;
    end if;
  end if;
end;
$$;

-- ── board CAS: service-scoped ────────────────────────────────
-- The old signature can only address the old (workspace, table) key — after
-- this migration such a write cannot name which service's row it means, so it
-- fails loudly instead of guessing. Old builds surface a sync-error chip and
-- keep their data locally; nothing on the server is touched.
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

revoke all on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;

-- ── legacy end-of-service RPC: NEUTERED ──────────────────────
-- Straggler shield. A device still running a pre-release build (stale PWA
-- cache, an old dev-server checkout) may replay a queued END SERVICE through
-- this function — possibly UNGUARDED (no expected identity). It must never
-- again be able to blank the board:
--   • the archive snapshot it carries is still filed (it is a genuine record
--     of the OLD service that device saw),
--   • the legacy service_date pointer is cleared only when the guard matches
--     (kept coherent for any not-yet-updated reader),
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
