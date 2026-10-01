-- ── Board batch CAS: a version miss must not spin inside PostgREST ──────────
--
-- save_service_tables_batch_if_current raised SQLSTATE 40001 on a version
-- miss so the whole gesture rolled back. 40001 is "serialization_failure",
-- and PostgREST's transaction layer retries that code automatically and
-- without limit — on the SAME request, with the SAME stale expected
-- version. The miss can never clear (only a fresh client re-read can), so a
-- single contended MOVE/SWAP became an endless server-side loop: ~650
-- function calls per second per stuck request, which is what drove the
-- Supabase CPU alert (831M PostgREST set_config calls since mid-August).
--
-- PT409 is a PostgREST custom code: it still aborts and rolls back the whole
-- call, but PostgREST answers HTTP 409 at once instead of retrying. The
-- client (saveServiceTablesBatchWithCas) re-reads and re-folds on PT409;
-- clients still matching only 40001 treat it as transient and PowerSync
-- retries the transaction with backoff, which is also correct.

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
        using errcode = 'PT409';
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.save_service_tables_batch_if_current(uuid, uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_tables_batch_if_current(uuid, uuid, jsonb, timestamptz)
  to authenticated, service_role;
