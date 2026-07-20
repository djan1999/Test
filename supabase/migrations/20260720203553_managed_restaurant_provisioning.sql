-- Atomic, server-only creation of one empty restaurant workspace.
-- The browser can never call this RPC directly: only service_role receives
-- EXECUTE, and the Vercel route separately verifies a platform-operator UUID.
create or replace function public.provision_managed_restaurant(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_admin_user_id uuid,
  p_operator_user_id uuid,
  p_operator_email text,
  p_keep_operator_admin boolean,
  p_restaurant_config jsonb,
  p_operations_config jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := btrim(lower(coalesce(p_slug, '')));
  v_tables jsonb;
  v_table jsonb;
  v_table_id_text text;
  v_table_id integer;
  v_table_label text;
  v_seen_table_ids integer[] := array[]::integer[];
begin
  if p_workspace_id is null or p_admin_user_id is null or p_operator_user_id is null then
    raise exception using errcode = '22023', message = 'Workspace, Admin, and operator ids are required.';
  end if;
  if v_name = '' or length(v_name) > 80 then
    raise exception using errcode = '22023', message = 'Restaurant name must be 1 to 80 characters.';
  end if;
  if length(v_slug) > 60 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'Restaurant slug is invalid.';
  end if;
  if jsonb_typeof(p_restaurant_config) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Restaurant configuration must be a JSON object.';
  end if;
  if coalesce(p_restaurant_config ->> 'version', '') <> '1'
     or btrim(coalesce(p_restaurant_config ->> 'name', '')) <> v_name
     or btrim(coalesce(p_restaurant_config ->> 'subtitle', '')) = ''
     or length(p_restaurant_config ->> 'subtitle') > 80 then
    raise exception using errcode = '22023', message = 'Restaurant identity configuration is invalid.';
  end if;
  if jsonb_typeof(p_operations_config) is distinct from 'object'
     or coalesce(p_operations_config ->> 'version', '') <> '1'
     or btrim(coalesce(p_operations_config ->> 'timezone', '')) = ''
     or length(p_operations_config ->> 'timezone') > 80 then
    raise exception using errcode = '22023', message = 'Restaurant timezone is invalid.';
  end if;

  v_tables := p_restaurant_config -> 'tables';
  if jsonb_typeof(v_tables) is distinct from 'array'
     or jsonb_array_length(v_tables) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'Configure between 1 and 60 restaurant tables.';
  end if;

  for v_table in select value from jsonb_array_elements(v_tables)
  loop
    if jsonb_typeof(v_table) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Every table configuration must be an object.';
    end if;
    v_table_id_text := coalesce(v_table ->> 'id', '');
    if v_table_id_text !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'Every table needs a numeric id.';
    end if;
    v_table_id := v_table_id_text::integer;
    v_table_label := btrim(coalesce(v_table ->> 'label', ''));
    if v_table_id not between 1 and 999 or v_table_id = any(v_seen_table_ids) then
      raise exception using errcode = '22023', message = 'Table ids must be unique numbers from 1 to 999.';
    end if;
    if v_table_label = '' or length(v_table_label) > 20 then
      raise exception using errcode = '22023', message = 'Table labels must be 1 to 20 characters.';
    end if;
    v_seen_table_ids := array_append(v_seen_table_ids, v_table_id);
  end loop;

  insert into public.workspaces (id, name, slug, kind)
  values (p_workspace_id, v_name, v_slug, 'restaurant');

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_admin_user_id, 'admin');

  if coalesce(p_keep_operator_admin, false) and p_operator_user_id <> p_admin_user_id then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, p_operator_user_id, 'admin');
  end if;

  insert into public.service_settings (workspace_id, id, state)
  values
    (p_workspace_id, 'restaurant_config_v1', p_restaurant_config),
    (p_workspace_id, 'restaurant_operations_v1', p_operations_config);

  foreach v_table_id in array v_seen_table_ids
  loop
    insert into public.service_tables (workspace_id, table_id, data)
    values (p_workspace_id, v_table_id, '{}'::jsonb);
  end loop;

  -- Server maintenance normally has no auth.uid(), so the general trigger
  -- intentionally skips it. Record this high-impact managed action explicitly.
  insert into public.audit_log (
    workspace_id, actor_id, actor_email, action, entity_type, entity_key, before_data, after_data
  ) values (
    p_workspace_id,
    p_operator_user_id,
    nullif(left(btrim(coalesce(p_operator_email, '')), 254), ''),
    'insert',
    'workspaces',
    p_workspace_id::text,
    null,
    jsonb_build_object(
      'id', p_workspace_id,
      'name', v_name,
      'slug', v_slug,
      'kind', 'restaurant',
      'admin_user_id', p_admin_user_id,
      'operator_kept_admin', coalesce(p_keep_operator_admin, false),
      'table_count', cardinality(v_seen_table_ids)
    )
  );

  return jsonb_build_object(
    'id', p_workspace_id,
    'name', v_name,
    'slug', v_slug,
    'adminUserId', p_admin_user_id,
    'operatorIsAdmin', coalesce(p_keep_operator_admin, false) or p_operator_user_id = p_admin_user_id,
    'tableCount', cardinality(v_seen_table_ids)
  );
end;
$$;

revoke all on function public.provision_managed_restaurant(
  uuid, text, text, uuid, uuid, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.provision_managed_restaurant(
  uuid, text, text, uuid, uuid, text, boolean, jsonb, jsonb
) to service_role;

-- SECURITY INVOKER means the server role needs explicit table/sequence access;
-- browser roles receive no new privileges.
grant select, insert on table public.workspaces, public.workspace_members,
  public.service_settings, public.service_tables, public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;
