-- ── The worked-content shield moves onto the board table itself (13.08) ──────
--
-- Until now the shield lived only inside the save RPCs. Every write path the
-- app HAS goes through them (pinned by tests: "the ONLY way table rows are
-- written"), but the tablets' database role also holds direct UPDATE on
-- service_tables — so a FUTURE code path that wrote the table directly would
-- have skipped the shield entirely. This closes that last theoretical route:
-- the same refusal now also runs as a BEFORE UPDATE trigger on the table, so
-- the wipe shape — empty-over-worked — cannot be written through ANY path
-- (RPC, direct client write, admin tooling, superuser typo) unless the shield
-- itself examined and passed that exact write.
--
-- Mechanism: assert_worked_content_shield, on PASSING its check, vouches for
-- the very next update of that table in this transaction (a transaction-local
-- setting the trigger consumes single-use). The legitimate worked→empty
-- writers all vouch:
--   · the save RPCs, through the assert they already call (all overloads
--     delegate to the asserting one), and
--   · restore_service_board — rewinding to before a table was seated is a
--     legitimate worked→empty write — explicitly, per rewound table.
-- Everything else faces the strict rule with no attestation path. A client
-- cannot mint a vouch: private.* is not exposed over the API, and the setting
-- dies with the transaction, so an RPC call cannot arm a later request.
-- Guest-erasure redaction never touches drinks/kitchen content (the predicate
-- fields), so it passes unvouched. DELETEs stay out of scope on purpose:
-- every delete's before-image is already in service_tables_history, and the
-- legitimate purge paths (archive forget, FK cascade) must keep working.

-- 1. The assert vouches for the write it just examined.
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
  -- The write this assert just cleared may proceed: vouch for THIS table's
  -- next update, transaction-local, consumed single-use by the trigger below.
  perform set_config('milka.shield_vouch', coalesce(p_table_id::text, ''), true);
end;
$$;

revoke all on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) from public, anon;
grant execute on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) to authenticated, service_role;

-- 2. The trigger: the same rule, at the destination, strict — no attestation
-- parameter exists here, because an un-shielded writer has no standing to
-- attest to anything.
create or replace function private.enforce_worked_content_shield()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(current_setting('milka.shield_vouch', true), '') = new.table_id::text then
    perform set_config('milka.shield_vouch', '', true); -- single-use
    return new;
  end if;
  if private.board_row_has_worked_content(old.data)
     and not private.board_row_has_worked_content(new.data) then
    raise exception 'Service table % holds worked content; an un-shielded write may not replace it with a skeleton', old.table_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_worked_content_shield() from public, anon, authenticated;

drop trigger if exists service_tables_worked_content_shield on public.service_tables;
create trigger service_tables_worked_content_shield
before update on public.service_tables
for each row execute function private.enforce_worked_content_shield();

-- 3. The Time Machine vouches for its own rewinds. Body identical to the
-- production function it replaces except the one vouch line before the upsert.
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
      -- A rewind to before this table was seated is a legitimate
      -- worked→empty write: vouch it through the table shield.
      perform set_config('milka.shield_vouch', version.table_id::text, true);
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
