-- ── The Logbook: service_events, the append-only event log ───────────────────
--
-- Phase 1 of the event-log migration (docs/EVENT_LOG_PLAN.md). Every gesture
-- in the restaurant becomes one small immutable fact; screens will eventually
-- derive their state by folding the facts. The safety property is structural:
-- the log has NO operation that means "replace this table", so the worst any
-- buggy device can ever do is append a wrong, visible, attributable, undoable
-- line. Append-only is enforced HERE, by Postgres — grants, RLS, and a guard
-- trigger — never by client discipline.
--
--   • id            server sequence — THE fold order (client clocks are never
--                   trusted for ordering)
--   • event_id      client-minted uuid — replaying an offline queue can never
--                   double-append (unique per workspace, ignore-duplicates)
--   • device_id     which tablet appended — every fact is attributable
--   • type/table_id/payload
--                   the fact, in domain language (course_fired, …)
--   • client_ts     when the device says it happened (display only)
--   • recorded_at   when the server accepted it (server clock)

create table if not exists public.service_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  service_id uuid not null,
  event_id uuid not null,
  device_id text not null,
  actor_id uuid,
  type text not null,
  table_id integer,
  payload jsonb not null default '{}'::jsonb,
  client_ts timestamptz,
  recorded_at timestamptz not null default clock_timestamp()
);

-- Composite FK (house pattern, pilot hardening): an event can only ever name
-- a service of ITS OWN workspace — RLS scopes the rows, the FK scopes the
-- reference, and the deliberate archive purge cascades through both.
alter table public.service_events
  drop constraint if exists service_events_workspace_service_fk;
alter table public.service_events
  add constraint service_events_workspace_service_fk
  foreign key (workspace_id, service_id)
  references public.services(workspace_id, id)
  on delete cascade;

create unique index if not exists service_events_identity_idx
  on public.service_events(workspace_id, event_id);
create index if not exists service_events_service_idx
  on public.service_events(workspace_id, service_id, id);
create index if not exists service_events_type_idx
  on public.service_events(workspace_id, service_id, type, id);

alter table public.service_events enable row level security;

-- Members APPEND and READ their workspace's log. There are deliberately no
-- UPDATE or DELETE policies: those verbs do not exist for clients.
drop policy if exists "service_events_member_read" on public.service_events;
create policy "service_events_member_read" on public.service_events
  for select using (
    private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen'])
  );
drop policy if exists "service_events_member_append" on public.service_events;
create policy "service_events_member_append" on public.service_events
  for insert with check (
    private.has_workspace_role(workspace_id, array['admin', 'service', 'kitchen'])
    and actor_id is not distinct from auth.uid()
  );

revoke all on table public.service_events from public, anon, authenticated;
grant select, insert on table public.service_events to authenticated;
grant all on table public.service_events to service_role;

-- Guard trigger: history is not rewritable, even by a code path that somehow
-- acquires the privilege. service_role (trusted maintenance: retention,
-- guest erasure) is exempt; everyone else — including any future definer
-- function that forgets itself — is refused.
create or replace function private.service_events_are_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A referential cascade (the deliberate archive purge deleting a service)
  -- arrives NESTED inside the FK's own trigger, so its depth is > 1; a direct
  -- UPDATE/DELETE statement arrives at depth 1 and is refused. service_role
  -- (trusted maintenance: guest erasure) and the migration superuser pass.
  if pg_trigger_depth() > 1
     or current_setting('role', true) = 'service_role'
     or session_user = 'postgres' then
    return coalesce(new, old);
  end if;
  raise exception 'service_events is append-only — facts are never rewritten'
    using errcode = '42501';
end;
$$;

revoke all on function private.service_events_are_append_only() from public, anon, authenticated;

drop trigger if exists service_events_append_only on public.service_events;
create trigger service_events_append_only
before update or delete on public.service_events
for each row execute function private.service_events_are_append_only();

-- Realtime: other devices tail the log live on the fallback path; PowerSync
-- picks it up once powersync/sync-rules.yaml (updated in this release) is
-- deployed in the dashboard.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'powersync' and schemaname = 'public' and tablename = 'service_events'
    ) then
      alter publication powersync add table public.service_events;
    end if;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_events'
    ) then
      alter publication supabase_realtime add table public.service_events;
    end if;
  end if;
end;
$$;

alter table public.service_events replica identity full;

-- ── guest erasure covers the log ─────────────────────────────────────────────
-- Event payloads may carry party-linked fields (a seated-party fact names the
-- party). Erasure redacts matching payloads via service_role — the one
-- trusted path allowed through the append-only guard. Everything else in the
-- function is unchanged from the board-history release.
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
  history_count integer := 0;
  event_count integer := 0;
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

  delete from public.service_tables_history
   where workspace_id = p_workspace_id
     and private.privacy_normalize_guest_name(data ->> 'resName') = p_normalized_name;
  get diagnostics history_count = row_count;

  update public.service_events
     set payload = private.privacy_redact_party(payload)
   where workspace_id = p_workspace_id
     and private.privacy_normalize_guest_name(payload ->> 'resName') = p_normalized_name;
  get diagnostics event_count = row_count;

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
      'serviceTablesHistory', history_count,
      'serviceEvents', event_count,
      'legacyArchives', archive_count,
      'auditRows', audit_count
    )),
    jsonb_build_object('status', 'erased')
  );

  return jsonb_build_object('counts', jsonb_build_object(
    'reservations', reservation_count,
    'serviceTables', board_count,
    'serviceTablesHistory', history_count,
    'serviceEvents', event_count,
    'legacyArchives', archive_count,
    'auditRows', audit_count
  ));
end;
$$;

revoke all on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  to service_role;
