-- Version-checked writes for shared service_settings documents.
--
-- The floor-map and floor-status rows are edited by several devices. A plain
-- upsert is last-writer-wins: even after the client performs a three-way merge,
-- another device can save between its read and write and still be erased.
-- This compare-and-swap function changes the row only while updated_at still
-- matches the version the client merged against. The client retries and folds
-- again when another writer wins first.
create or replace function public.save_service_setting_if_current(
  p_workspace_id uuid,
  p_id text,
  p_expected_updated_at timestamptz,
  p_state jsonb,
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
  if p_workspace_id is null or nullif(p_id, '') is null then
    raise exception 'workspace_id and setting id are required';
  end if;

  if p_expected_updated_at is null then
    insert into public.service_settings(workspace_id, id, state, updated_at)
    values (
      p_workspace_id,
      p_id,
      coalesce(p_state, '{}'::jsonb),
      coalesce(p_updated_at, clock_timestamp())
    )
    on conflict (workspace_id, id) do nothing;
  else
    update public.service_settings as setting
       set state = coalesce(p_state, '{}'::jsonb),
           updated_at = coalesce(p_updated_at, clock_timestamp())
     where setting.workspace_id = p_workspace_id
       and setting.id = p_id
       and setting.updated_at = p_expected_updated_at;
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_service_setting_if_current(uuid, text, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_service_setting_if_current(uuid, text, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;
-- Reservation compare-and-swap without adding an updated_at column. The full
-- previous date/table/data tuple is the version token.
create or replace function public.save_reservation_if_current(
  p_workspace_id uuid,
  p_id uuid,
  p_expected_date date,
  p_expected_table_id integer,
  p_expected_data jsonb,
  p_date date,
  p_table_id integer,
  p_data jsonb,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer := 0;
begin
  if p_workspace_id is null or p_id is null then
    raise exception 'workspace_id and reservation id are required';
  end if;
  if p_date is null or p_table_id is null then
    raise exception 'reservation date and table_id are required';
  end if;

  if p_expected_date is null then
    insert into public.reservations(id, workspace_id, date, table_id, data, created_at)
    values (
      p_id,
      p_workspace_id,
      p_date,
      p_table_id,
      coalesce(p_data, '{}'::jsonb),
      coalesce(p_created_at, clock_timestamp())
    )
    on conflict (id) do nothing;
  else
    update public.reservations as reservation
       set date = p_date,
           table_id = p_table_id,
           data = coalesce(p_data, '{}'::jsonb)
     where reservation.id = p_id
       and reservation.workspace_id = p_workspace_id
       and reservation.date is not distinct from p_expected_date
       and reservation.table_id is not distinct from p_expected_table_id
       and reservation.data is not distinct from coalesce(p_expected_data, '{}'::jsonb);
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.save_reservation_if_current(
  uuid, uuid, date, integer, jsonb, date, integer, jsonb, timestamptz
) from public, anon;
grant execute on function public.save_reservation_if_current(
  uuid, uuid, date, integer, jsonb, date, integer, jsonb, timestamptz
) to authenticated, service_role;
