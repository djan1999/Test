-- Guarded end-of-service hardening (19.07).
--
-- Two gaps closed in archive_and_finish_service:
--
-- 1. The archive is filed BEFORE the identity guard decides. A finish queued
--    on an offline device replays here after the store may have moved on to a
--    newer service; the guard rightly refuses the board wipe, but the OLD
--    service's snapshot is still real data — without this reorder it was
--    silently discarded together with the refused clears. The deterministic
--    archive id (uuid from workspace+startedAt) plus `on conflict do nothing`
--    keeps a double-end from duplicating: whoever files first wins.
--
-- 2. The board blank covers EVERY row the workspace owns, not
--    generate_series(1, 10). The configurable-floor feature accepts table ids
--    1..999 (service_tables_table_id_check) and clients queue blanks for the
--    configured id set, but this function — the one path every end ultimately
--    funnels through — still only cleared the legacy ten. Any workspace
--    configured beyond id 10 kept those rows' data across the end, and they
--    synced back as ghost tables into the next service. schema.sql's
--    fresh-install copy was already fixed; this migration backports it to
--    databases provisioned through the migration chain.

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

  -- File the archive first: even a superseded finish carries a genuine
  -- snapshot of the service it ended. Deterministic ids dedup double-ends.
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

  -- Clear exactly the rows this workspace currently owns. This automatically
  -- covers 6, 10, 14, or any later configured table count and also cleans old
  -- retired rows left from a previous layout.
  update public.service_tables
     set data = '{}'::jsonb, updated_at = clock_timestamp()
   where workspace_id = p_workspace_id;

  return jsonb_build_object('superseded', false);
end;
$$;

revoke all on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  from public, anon;
grant execute on function public.archive_and_finish_service(uuid, uuid, date, text, jsonb, text, text)
  to authenticated, service_role;
