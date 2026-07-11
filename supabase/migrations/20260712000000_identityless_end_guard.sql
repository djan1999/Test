-- An identity-less live service must not deadlock END SERVICE (12.07).
--
-- Production incident (11.07 night): the store's service_date state was
-- rewritten as {date, chosenOn} — no startedAt (the orphan-heal path wrote an
-- identity-less blob). Every tablet still presented the startedAt it had kept
-- from an earlier service, so the identity guard below compared
-- NULL = '<stamp>' → refused → "This service was already ended on another
-- device" on every attempt, while the board kept showing the whole night.
-- Adoption could not self-heal: the state carried no startedAt to adopt.
--
-- Fix: when the STORE's state has no startedAt there is no identity to check
-- against — fall back to the date check alone. This mirrors what the client
-- pre-check (serviceEndSuperseded) has always done in that direction, and it
-- is exactly the existing legacy rule mirrored store-side: a CALLER without a
-- startedAt is already judged by date alone. Every guarded case where both
-- sides carry a stamp is unchanged, so a stale device still cannot wipe a
-- newer identified service.

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
  if p_archive_id is not null and (p_archive_date is null or nullif(p_archive_label, '') is null) then
    raise exception 'archive date and label are required';
  end if;

  -- The atomic guard: clear the date ONLY while it still names the service
  -- being ended. row_count = 0 under a guard means the store moved on.
  -- A state with NO startedAt has no identity to mismatch — date decides.
  update public.service_settings
     set state = '{}'::jsonb, updated_at = clock_timestamp()
   where workspace_id = p_workspace_id
     and id = 'service_date'
     and (
       not guarded
       or (
         (p_expected_started_at is null
           or state->>'startedAt' is null
           or state->>'startedAt' = p_expected_started_at)
         and (p_expected_date is null or state->>'date' = p_expected_date)
       )
     );
  get diagnostics cleared = row_count;

  if guarded and cleared = 0 then
    return jsonb_build_object('superseded', true);
  end if;

  -- Unguarded legacy path on a workspace with no service_date row yet:
  -- keep the old semantics (materialize the cleared row).
  if cleared = 0 then
    insert into public.service_settings(workspace_id, id, state, updated_at)
    values (p_workspace_id, 'service_date', '{}'::jsonb, clock_timestamp())
    on conflict (workspace_id, id)
    do update set state = '{}'::jsonb, updated_at = excluded.updated_at;
  end if;

  if p_archive_id is not null then
    insert into public.service_archive(
      id, workspace_id, date, label, state, created_at, deleted_at
    )
    values (
      p_archive_id, p_workspace_id, p_archive_date, p_archive_label,
      coalesce(p_archive_state, '{}'::jsonb), clock_timestamp(), null
    )
    on conflict (id) do nothing;
  end if;

  insert into public.service_tables(workspace_id, table_id, data, updated_at)
  select p_workspace_id, table_id, '{}'::jsonb, clock_timestamp()
  from generate_series(1, 10) as table_id
  on conflict (workspace_id, table_id)
  do update set data = '{}'::jsonb, updated_at = excluded.updated_at;

  return jsonb_build_object('superseded', false);
end;
$$;

revoke all on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  from public, anon;
grant execute on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  to authenticated, service_role;
