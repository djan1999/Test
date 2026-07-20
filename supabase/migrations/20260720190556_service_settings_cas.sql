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
