-- ── Board history + worked-content shield ────────────────────────────────────
--
-- After the 08.08 incident the client carries four independent defenses
-- against a service wipe (boot gate, blind-start guard, scoped board truth,
-- client-side CAS refusal). This migration moves the guarantee INTO the
-- database, where no present or future client bug can reach it:
--
--   1. service_tables_history — every version of every board row, recorded by
--      an AFTER trigger Postgres itself runs. Clients cannot write to it,
--      cannot skip it, and cannot delete from it. Whatever any device ever
--      does to the board, the pre-change state exists on the server. Data can
--      no longer be LOST — only superseded, recoverably.
--   2. A worked-content shield inside the save RPCs: a write may not replace
--      a row holding worked content (kitchen activity, drinks, seat data)
--      with one holding none, unless the writer attests it SAW that content
--      (allow_clear — derived from the device's synced ancestor). This is the
--      client-side unsynced-overwrite refusal, enforced where it cannot be
--      bypassed.
--   3. restore_service_board — the admin time machine: put a service's board
--      back to any moment. Restores write through the normal row path, so
--      they are themselves recorded and undoable, and they replicate to every
--      device like any other edit.
--
-- Guest erasure (erase_workspace_guest) is extended to purge the erased
-- party's history versions, so the privacy contract holds end to end.

-- ── 1. history table ─────────────────────────────────────────────────────────

create table if not exists public.service_tables_history (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  service_id uuid not null references public.services(id) on delete cascade,
  table_id integer not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  data jsonb not null,
  row_updated_at timestamptz,       -- the row's own stamp (client clock)
  recorded_at timestamptz not null default clock_timestamp() -- server clock
);

create index if not exists service_tables_history_key_idx
  on public.service_tables_history(workspace_id, service_id, table_id, id desc);
create index if not exists service_tables_history_time_idx
  on public.service_tables_history(workspace_id, service_id, recorded_at);

alter table public.service_tables_history enable row level security;

-- Admins may READ the history (the time-machine picker); nobody writes it
-- from a client — only the definer trigger below inserts, and only the
-- services FK cascade (deliberate archive purge) or guest erasure deletes.
drop policy if exists "service_tables_history_admin_read" on public.service_tables_history;
create policy "service_tables_history_admin_read" on public.service_tables_history
  for select using (private.has_workspace_role(workspace_id, array['admin']));

revoke all on table public.service_tables_history from public, anon, authenticated;
grant select on table public.service_tables_history to authenticated;
grant all on table public.service_tables_history to service_role;

-- ── 2. recorder trigger ──────────────────────────────────────────────────────
-- SECURITY DEFINER: the recording must succeed regardless of the caller's
-- grants — it is the database's own black box, not a client feature. Each
-- write also prunes that key's history beyond the newest 48 versions, so
-- growth stays bounded per table without any external job. (A whole service's
-- history disappears only with the service itself — the FK cascade on a
-- deliberate archive purge.)
create or replace function private.record_service_table_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_versions constant integer := 48;
begin
  if tg_op = 'UPDATE'
     and new.data is not distinct from old.data
     and new.updated_at is not distinct from old.updated_at then
    return new; -- nothing changed — no version to record
  end if;
  if tg_op = 'DELETE' then
    insert into public.service_tables_history(
      workspace_id, service_id, table_id, op, data, row_updated_at
    ) values (
      old.workspace_id, old.service_id, old.table_id, 'delete', old.data, old.updated_at
    );
    return old;
  end if;
  insert into public.service_tables_history(
    workspace_id, service_id, table_id, op, data, row_updated_at
  ) values (
    new.workspace_id, new.service_id, new.table_id,
    case tg_op when 'INSERT' then 'insert' else 'update' end,
    new.data, new.updated_at
  );
  delete from public.service_tables_history pruned
   where pruned.workspace_id = new.workspace_id
     and pruned.service_id = new.service_id
     and pruned.table_id = new.table_id
     and pruned.id < (
       select min(kept.id) from (
         select h.id from public.service_tables_history h
          where h.workspace_id = new.workspace_id
            and h.service_id = new.service_id
            and h.table_id = new.table_id
          order by h.id desc
          limit keep_versions
       ) kept
     );
  return new;
end;
$$;

revoke all on function private.record_service_table_history() from public, anon, authenticated;

drop trigger if exists service_tables_history_recorder on public.service_tables;
create trigger service_tables_history_recorder
after insert or update or delete on public.service_tables
for each row execute function private.record_service_table_history();

-- ── 3. worked-content predicate + shielded save RPCs ─────────────────────────
-- Mirrors lib/serviceTableCas.js hasWorkedContent EXACTLY: content that took
-- work to enter — kitchen activity, bottles, any seat with drinks/pairings/
-- extras. The reservation skeleton a blind device rebuilds must NOT count.
create or replace function private.board_row_has_worked_content(d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select d is not null and (
    (jsonb_typeof(d -> 'kitchenLog') = 'object' and d -> 'kitchenLog' <> '{}'::jsonb)
    or (jsonb_typeof(d -> 'bottleWines') = 'array' and jsonb_array_length(d -> 'bottleWines') > 0)
    or (d ? 'kitchenSent' and d -> 'kitchenSent' not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb))
    or (d ? 'courseReady' and d -> 'courseReady' not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb))
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(d -> 'seats') = 'array' then d -> 'seats' else '[]'::jsonb end
        ) seat(s)
       where nullif(nullif(s ->> 'water', ''), '—') is not null
          or nullif(nullif(s ->> 'pairing', ''), '—') is not null
          or (jsonb_typeof(s -> 'aperitifs') = 'array' and jsonb_array_length(s -> 'aperitifs') > 0)
          or (jsonb_typeof(s -> 'glasses') = 'array' and jsonb_array_length(s -> 'glasses') > 0)
          or (jsonb_typeof(s -> 'cocktails') = 'array' and jsonb_array_length(s -> 'cocktails') > 0)
          or (jsonb_typeof(s -> 'spirits') = 'array' and jsonb_array_length(s -> 'spirits') > 0)
          or (jsonb_typeof(s -> 'beers') = 'array' and jsonb_array_length(s -> 'beers') > 0)
          or exists (
            select 1 from jsonb_each(
              case when jsonb_typeof(s -> 'extras') = 'object' then s -> 'extras' else '{}'::jsonb end
            ) extra(k, v) where v -> 'ordered' = 'true'::jsonb
          )
          or exists (
            select 1 from jsonb_each(
              case when jsonb_typeof(s -> 'optionalPairings') = 'object' then s -> 'optionalPairings' else '{}'::jsonb end
            ) op(k, v) where v -> 'ordered' = 'true'::jsonb
          )
    )
  );
$$;

revoke all on function private.board_row_has_worked_content(jsonb) from public, anon;
grant execute on function private.board_row_has_worked_content(jsonb) to authenticated, service_role;

-- The shield itself. errcode 23514 (check_violation): the uploader treats it
-- as a final verdict — the gesture is dropped and the device converges to the
-- server's row, exactly like the client-side MILKA_TABLE_CONFLICT refusal.
create or replace function private.assert_worked_content_shield(
  p_current jsonb,
  p_incoming jsonb,
  p_allow_clear boolean,
  p_table_id integer
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_allow_clear, false)
     and private.board_row_has_worked_content(p_current)
     and not private.board_row_has_worked_content(p_incoming) then
    raise exception 'Service table % holds worked content; a writer that has not synced it may not replace it with a skeleton', p_table_id
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) from public, anon;
grant execute on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) to authenticated, service_role;

-- Shielded single-row CAS. p_allow_clear is the writer's attestation that its
-- synced ancestor HELD the worked content it is clearing (a deliberate CLEAR/
-- MOVE by a device that saw the table) — derived mechanically by the client
-- from its last-synced copy, never a user choice.
create or replace function public.save_service_table_if_current(
  p_workspace_id uuid,
  p_service_id uuid,
  p_table_id integer,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_updated_at timestamptz,
  p_allow_clear boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer := 0;
  current_data jsonb;
begin
  if p_workspace_id is null or p_service_id is null then
    raise exception 'workspace_id and service_id are required';
  end if;
  if p_expected_updated_at is null then
    insert into public.service_tables(workspace_id, service_id, table_id, data, updated_at)
    values (p_workspace_id, p_service_id, p_table_id, coalesce(p_data, '{}'::jsonb), p_updated_at)
    on conflict (workspace_id, service_id, table_id) do nothing;
  else
    select data into current_data
      from public.service_tables
     where workspace_id = p_workspace_id
       and service_id = p_service_id
       and table_id = p_table_id
       for update;
    perform private.assert_worked_content_shield(
      current_data, coalesce(p_data, '{}'::jsonb), p_allow_clear, p_table_id
    );
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

revoke all on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz, boolean)
  from public, anon;
grant execute on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz, boolean)
  to authenticated, service_role;

-- The pre-shield 6-arg signature delegates WITH THE SHIELD STRICT
-- (allow_clear false). A not-yet-updated build keeps saving normally; only
-- its worked→skeleton overwrites — the wipe class — are refused until the
-- boot update gate moves it to the new build at its next open. Leaving this
-- signature callable-but-shielded also means a future client bug that omits
-- p_allow_clear gets the STRICT shield, never a bypass.
create or replace function public.save_service_table_if_current(
  p_workspace_id uuid,
  p_service_id uuid,
  p_table_id integer,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_updated_at timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select public.save_service_table_if_current(
    p_workspace_id, p_service_id, p_table_id,
    p_expected_updated_at, p_data, p_updated_at, false
  );
$$;

revoke all on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_table_if_current(uuid, uuid, integer, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;

-- Shielded batch CAS: each row carries its own allow_clear attestation (a
-- MOVE clears its source with allow_clear=true — the device saw the party it
-- is moving — while the destination write carries the content itself).
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
  current_data jsonb;
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
      select data into current_data
        from public.service_tables
       where workspace_id = p_workspace_id
         and service_id = p_service_id
         and table_id = target_table_id
         for update;
      perform private.assert_worked_content_shield(
        current_data,
        coalesce(item -> 'data', '{}'::jsonb),
        coalesce((item ->> 'allow_clear')::boolean, false),
        target_table_id
      );
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

-- ── 4. the time machine ──────────────────────────────────────────────────────
-- Restore a service's board to its state at p_at (server clock). Every table
-- that has a recorded version at-or-before p_at is rewritten to that version;
-- a table whose version at p_at was 'delete' is removed; a table that only
-- appeared AFTER p_at is left in place (never destroy what cannot be proven).
-- The rewrites go through the normal row path: the recorder logs them (a
-- restore is itself undoable) and they replicate to every device like any
-- other edit. Admin-only — checked FIRST, because the function is SECURITY
-- DEFINER (the audit insert and history reads run as owner; auth.uid() still
-- identifies the calling admin through the JWT).
create or replace function public.restore_service_board(
  p_workspace_id uuid,
  p_service_id uuid,
  p_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored integer := 0;
  changed integer := 0;
  version record;
begin
  if not private.has_workspace_role(p_workspace_id, array['admin']) then
    raise exception 'Only an Admin can restore a service board'
      using errcode = 'insufficient_privilege';
  end if;
  if p_at is null then
    raise exception 'A restore needs the moment to restore to' using errcode = '22023';
  end if;

  for version in
    select distinct on (h.table_id) h.table_id, h.op, h.data
      from public.service_tables_history h
     where h.workspace_id = p_workspace_id
       and h.service_id = p_service_id
       and h.recorded_at <= p_at
     order by h.table_id, h.id desc
  loop
    if version.op = 'delete' then
      delete from public.service_tables
       where workspace_id = p_workspace_id
         and service_id = p_service_id
         and table_id = version.table_id;
      get diagnostics changed = row_count;
    else
      insert into public.service_tables(workspace_id, service_id, table_id, data, updated_at)
      values (p_workspace_id, p_service_id, version.table_id, version.data, clock_timestamp())
      on conflict (workspace_id, service_id, table_id) do update
        set data = excluded.data, updated_at = excluded.updated_at
        where public.service_tables.data is distinct from excluded.data;
      get diagnostics changed = row_count;
    end if;
    restored := restored + changed;
  end loop;

  insert into public.audit_log(
    workspace_id, actor_id, actor_email, action, entity_type, entity_key,
    before_data, after_data
  ) values (
    p_workspace_id, auth.uid(), null, 'update',
    'board_time_machine_restore', p_service_id::text,
    null, jsonb_build_object('restored_rows', restored, 'restored_to', p_at)
  );

  return restored;
end;
$$;

revoke all on function public.restore_service_board(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.restore_service_board(uuid, uuid, timestamptz) to authenticated, service_role;

-- ── 5. guest erasure covers history ──────────────────────────────────────────
-- The recorder keeps pre-redaction versions of a redacted row, so erasure
-- must purge the erased party's history versions too. Everything else in the
-- function is unchanged from the pilot-hardening release.
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

  -- History versions recorded BEFORE the redaction still carry the party —
  -- purge them. (The redaction above was itself recorded; that version no
  -- longer matches the name and stays, as it should.) service_role-adjacent:
  -- this function is the only authenticated path that deletes history.
  delete from public.service_tables_history
   where workspace_id = p_workspace_id
     and private.privacy_normalize_guest_name(data ->> 'resName') = p_normalized_name;
  get diagnostics history_count = row_count;

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
      'legacyArchives', archive_count,
      'auditRows', audit_count
    )),
    jsonb_build_object('status', 'erased')
  );

  return jsonb_build_object('counts', jsonb_build_object(
    'reservations', reservation_count,
    'serviceTables', board_count,
    'serviceTablesHistory', history_count,
    'legacyArchives', archive_count,
    'auditRows', audit_count
  ));
end;
$$;

revoke all on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.erase_workspace_guest(uuid, uuid, text, text, text)
  to service_role;
