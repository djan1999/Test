-- Remove the special cross-restaurant account. Every authenticated account now
-- reaches data only through explicit workspace_members rows. The role column is
-- retained for future roles, but membership currently grants full restaurant
-- owner/admin capability.

drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read" on public.workspaces
  for select to authenticated
  using (private.is_workspace_member(id));

drop policy if exists "members_self_read" on public.workspace_members;
create policy "members_self_read" on public.workspace_members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "service_tables_member_all" on public.service_tables;
create policy "service_tables_member_all" on public.service_tables
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "service_archive_member_all" on public.service_archive;
create policy "service_archive_member_all" on public.service_archive
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "reservations_member_all" on public.reservations;
create policy "reservations_member_all" on public.reservations
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "menu_courses_member_read" on public.menu_courses;
drop policy if exists "menu_courses_owner_write" on public.menu_courses;
drop policy if exists "menu_courses_member_all" on public.menu_courses;
create policy "menu_courses_member_all" on public.menu_courses
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "wines_member_read" on public.wines;
drop policy if exists "wines_owner_write" on public.wines;
drop policy if exists "wines_member_all" on public.wines;
create policy "wines_member_all" on public.wines
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "beverages_member_read" on public.beverages;
drop policy if exists "beverages_owner_write" on public.beverages;
drop policy if exists "beverages_member_all" on public.beverages;
create policy "beverages_member_all" on public.beverages
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

drop policy if exists "service_settings_member_read" on public.service_settings;
drop policy if exists "service_settings_owner_write" on public.service_settings;
drop policy if exists "service_settings_staff_operational_write" on public.service_settings;
drop policy if exists "service_settings_member_all" on public.service_settings;
create policy "service_settings_member_all" on public.service_settings
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- All policy dependencies are gone, so the special authorization objects can
-- be removed without CASCADE and without touching restaurant data.
drop function if exists private.is_workspace_owner(uuid);
drop function if exists private.is_platform_admin();
drop table if exists public.platform_admins;
