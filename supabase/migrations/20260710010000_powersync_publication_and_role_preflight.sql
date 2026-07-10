-- PowerSync must receive both the workspace membership lookup and every table
-- referenced by the deployed sync streams. Keep this idempotent so a project
-- can be reconstructed from the repository instead of dashboard memory.
do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    execute 'create publication powersync';
  end if;

  foreach table_name in array array[
    'workspace_members',
    'service_tables',
    'reservations',
    'service_settings',
    'menu_courses',
    'beverages',
    'wines',
    'service_archive'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication powersync add table public.%I', table_name);
    end if;
  end loop;
end
$$;

-- Do not silently promote accounts. Emit a deployment warning if the Milka
-- workspace has no owner; the operator must deliberately choose the account.
do $$
begin
  if exists (select 1 from public.workspaces where slug = 'milka')
     and not exists (
       select 1
       from public.workspace_members m
       join public.workspaces w on w.id = m.workspace_id
       where w.slug = 'milka' and m.role = 'owner'
     ) then
    raise warning 'Milka has no owner membership. Admin mode and admin writes will be unavailable until an intended account is promoted.';
  end if;
end
$$;

