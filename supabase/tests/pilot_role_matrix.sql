-- Executable tenant/role contract for the restaurant pilot.
-- Run with: supabase test db

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select no_plan();

-- PostgreSQL does not allow a data-modifying CTE nested directly inside a
-- pgTAP assertion expression. Keep the DML top-level inside dynamic SQL and
-- return its affected-row count for exact RLS assertions.
create or replace function pg_temp.affected_rows(statement text)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create table public.pilot_rls_probe(id integer primary key);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pilot_rls_probe'::regclass),
  'the DDL event trigger enables RLS on every new public table'
);
drop table public.pilot_rls_probe;

-- Deterministic fixture identities; the transaction is rolled back at EOF.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'service-a@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-a@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'service-b@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, name, slug, kind) values
  ('20000000-0000-0000-0000-000000000001', 'Test Restaurant A', 'rls-test-a', 'sandbox'),
  ('20000000-0000-0000-0000-000000000002', 'Test Restaurant B', 'rls-test-b', 'sandbox');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'service'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'kitchen'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'service');

insert into public.services (
  id, workspace_id, date, session, started_at, status, ended_at,
  deleted_at, snapshot, updated_at
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', current_date, 'dinner', now() - interval '2 hours', 'live', null, null, null, now()),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', current_date - 1, 'dinner', now() - interval '1 day', 'ended', now() - interval '22 hours', null, '{"guest":"must-not-be-copied-to-audit"}', now()),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', current_date, 'dinner', now() - interval '1 hour', 'live', null, null, null, now());

insert into public.service_tables (workspace_id, service_id, table_id, data, updated_at)
values
(
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  1,
  '{"active":true}',
  now()
),
(
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  9,
  '{"active":true,"resName":"Erase Me","room":"204"}',
  now()
);

insert into public.reservations (id, workspace_id, date, table_id, data, created_at)
values
(
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  current_date,
  1,
  '{"resName":"Fixture"}',
  now()
),
(
  '40000000-0000-0000-0000-000000000009',
  '20000000-0000-0000-0000-000000000001',
  current_date,
  9,
  '{"resName":"Erase Me","room":"204"}',
  now()
);

insert into public.service_settings (workspace_id, id, state, updated_at) values
  ('20000000-0000-0000-0000-000000000001', 'kitchen_ticket_order', '{"ids":[]}', now()),
  ('20000000-0000-0000-0000-000000000001', 'restaurant_config_v1', '{"name":"Fixture"}', now());

select ok(
  not has_table_privilege('authenticated', 'public.services', 'TRUNCATE'),
  'authenticated cannot TRUNCATE services'
);
select ok(
  not has_table_privilege('authenticated', 'public.service_tables', 'TRUNCATE'),
  'authenticated cannot TRUNCATE service_tables'
);
select ok(
  not has_table_privilege('anon', 'public.services', 'SELECT'),
  'anon cannot read services'
);
select is(
  (select relreplident::text from pg_class where oid = 'public.wines'::regclass),
  'f',
  'filtered fallback Realtime deletes carry the full old row'
);
select ok(
  to_regclass('public.service_tables_backup_20260724') is null
  or not has_table_privilege('authenticated', 'public.service_tables_backup_20260724', 'SELECT'),
  'the production backup table is not browser-readable when present'
);
select is(
  (select array_to_string(proconfig, ',')
     from pg_proc
    where oid = 'private.is_workspace_member(uuid)'::regprocedure),
  'search_path=""',
  'membership helper has an empty search_path'
);
select ok(
  to_regprocedure('public.set_updated_at_service_tables()') is null
  and to_regprocedure('public.set_updated_at_service_settings()') is null
  and to_regprocedure('public.update_synced_at()') is null,
  'orphan trigger helpers are absent from the canonical schema'
);
select is(
  (select count(*)::integer
     from pg_policies
    where schemaname = 'public'
      and tablename in ('menu_courses', 'wines', 'beverages')
      and cmd = 'SELECT'),
  3,
  'each reference catalogue has exactly one SELECT policy'
);
select ok(
  to_regclass('public.wines_ws_idx') is null,
  'the duplicate production wine index is absent'
);

select throws_ok(
  $$select public.save_service_tables_batch_if_current(
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'table_id', 1,
          'expected_updated_at', (select updated_at from public.service_tables
            where workspace_id = '20000000-0000-0000-0000-000000000001'
              and service_id = '30000000-0000-0000-0000-000000000001'
              and table_id = 1),
          'data', '{"active":false}'::jsonb
        ),
        jsonb_build_object(
          'table_id', 9,
          'expected_updated_at', '2000-01-01T00:00:00Z',
          'data', '{"active":false}'::jsonb
        )
      ),
      clock_timestamp()
    )$$,
  '40001'::character(5),
  null::text,
  'a version miss aborts the whole multi-table board gesture'
);
select is(
  (select data from public.service_tables
    where workspace_id = '20000000-0000-0000-0000-000000000001'
      and service_id = '30000000-0000-0000-0000-000000000001'
      and table_id = 1),
  '{"active":true}'::jsonb,
  'the earlier row in a refused board batch was rolled back'
);

select lives_ok(
  $$select public.erase_workspace_guest(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'admin-a@test.invalid',
      private.privacy_normalize_guest_name('Erase Me'),
      private.privacy_guest_token(
        '20000000-0000-0000-0000-000000000001',
        private.privacy_normalize_guest_name('Erase Me')
      )
    )$$,
  'guest erasure completes as one database transaction'
);
select is(
  (select count(*)::integer from public.reservations
    where id = '40000000-0000-0000-0000-000000000009'),
  0,
  'guest erasure deletes the matching reservation'
);
select is(
  (select data ->> 'resName' from public.service_tables where table_id = 9),
  '[erased]',
  'guest erasure redacts the current service row'
);
select is(
  (select count(*)::integer from public.audit_log
    where entity_type = 'privacy_guest_erasure'),
  1,
  'guest erasure and its audit record commit together'
);

-- Admin A is intentionally also Admin B: RLS permits both workspaces, so only
-- the composite FK can reject a mixed A-row/B-service relationship.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","email":"admin-a@test.invalid"}',
  true
);

select is((select count(*)::integer from public.services), 3, 'a multi-workspace Admin sees only its memberships');

select throws_ok(
  $$insert into public.service_tables (workspace_id, service_id, table_id, data, updated_at)
    values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 99, '{}', now())$$,
  '23503'::character(5),
  null::text,
  'the composite FK rejects a cross-restaurant board row'
);

select throws_ok(
  $$update public.services
       set workspace_id = '20000000-0000-0000-0000-000000000002'
     where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'even an Admin cannot move a service between restaurants'
);

select throws_ok(
  $$update public.services
       set started_at = started_at - interval '1 hour'
     where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'even an Admin cannot rewrite service start identity'
);

select throws_ok(
  $$update public.reservations
       set workspace_id = '20000000-0000-0000-0000-000000000002'
     where id = '40000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'a dual-workspace Admin cannot move a reservation between restaurants'
);

select throws_ok(
  $$insert into public.reservations(id, workspace_id, date, table_id, data, created_at)
    values (
      '40000000-0000-0000-0000-000000000008',
      '20000000-0000-0000-0000-000000000001',
      current_date,
      8,
      '{"resName":"Erase Me"}',
      now()
    )$$,
  'MG001'::character(5),
  null::text,
  'a stale tablet cannot replay an erased guest into reservations'
);

select lives_ok(
  $$insert into public.menu_courses (workspace_id, position, menu, updated_at)
    values ('20000000-0000-0000-0000-000000000001', 1, '{"name":"Fixture course"}', now())$$,
  'Admin can create a menu course'
);
select lives_ok(
  $$insert into public.wines (workspace_id, key, producer, name, source, updated_at)
    values ('20000000-0000-0000-0000-000000000001', 'fixture-wine', 'Fixture', 'Wine', 'manual', now())$$,
  'Admin can create a wine'
);
select lives_ok(
  $$insert into public.beverages (workspace_id, category, name, source, updated_at)
    values ('20000000-0000-0000-0000-000000000001', 'cocktail', 'Fixture drink', 'manual', now())$$,
  'Admin can create a beverage'
);

select is(pg_temp.affected_rows(
  $$update public.services
       set deleted_at = now(), updated_at = now()
     where id = '30000000-0000-0000-0000-000000000002'$$
), 1, 'Admin can move an ended service to trash');

select is(pg_temp.affected_rows(
  $$delete from public.services
     where id = '30000000-0000-0000-0000-000000000001'$$
), 0, 'Admin cannot hard-delete a live service');

select is(pg_temp.affected_rows(
  $$delete from public.services
     where id = '30000000-0000-0000-0000-000000000002'$$
), 1, 'Admin can purge an ended service only after trashing it');

select is((
  select count(*)::integer
    from public.audit_log
   where entity_type = 'services'
     and (coalesce(before_data ? 'snapshot', false) or coalesce(after_data ? 'snapshot', false))
), 0, 'service audit entries do not duplicate guest snapshots');

-- Service A: lifecycle and reservations are operational; archive destruction
-- and Admin settings are not.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","email":"service-a@test.invalid"}',
  true
);

select is((select count(*)::integer from public.services), 1, 'Service sees restaurant A only');
select is((select count(*)::integer from public.services where workspace_id = '20000000-0000-0000-0000-000000000002'), 0, 'Service cannot read restaurant B');

select lives_ok(
  $$insert into public.services (id, workspace_id, date, session, started_at, status, updated_at)
    values ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', current_date, 'dinner', now(), 'live', now())$$,
  'Service can start a service'
);

select is(pg_temp.affected_rows(
  $$update public.services
       set status = 'ended', ended_at = now(), end_reason = 'manual', updated_at = now()
     where id = '30000000-0000-0000-0000-000000000004'$$
), 1, 'Service can end the service it operates');

select throws_ok(
  $$update public.services
       set deleted_at = now(), updated_at = now()
     where id = '30000000-0000-0000-0000-000000000004'$$,
  '42501'::character(5),
  null::text,
  'Service cannot trash a service archive entry'
);

select lives_ok(
  $$insert into public.service_archive (id, workspace_id, date, label, state, created_at)
    values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', current_date, 'Compatibility fixture', '{"tables":[{"guest":"redact"}]}', now())$$,
  'Service may write a legacy compatibility snapshot'
);

select is(pg_temp.affected_rows(
  $$update public.service_archive
       set deleted_at = now()
     where id = '50000000-0000-0000-0000-000000000001'$$
), 0, 'Service cannot trash a legacy archive entry');

select is(pg_temp.affected_rows(
  $$delete from public.service_archive
     where id = '50000000-0000-0000-0000-000000000001'$$
), 0, 'Service cannot permanently delete a legacy archive entry');

select lives_ok(
  $$insert into public.reservations (id, workspace_id, date, table_id, data, created_at)
    values ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', current_date, 2, '{"resName":"Service"}', now())$$,
  'Service can create a reservation'
);

select is(pg_temp.affected_rows(
  $$delete from public.reservations
     where id = '40000000-0000-0000-0000-000000000002'$$
), 1, 'Service can delete a reservation');

select is(pg_temp.affected_rows(
  $$update public.service_settings
       set state = '{"name":"Tampered"}', updated_at = now()
     where workspace_id = '20000000-0000-0000-0000-000000000001'
       and id = 'restaurant_config_v1'$$
), 0, 'Service cannot edit Admin restaurant settings');

select is((select count(*)::integer from public.menu_courses), 1, 'Service can read menu courses');
select is((select count(*)::integer from public.wines), 1, 'Service can read wines');
select is((select count(*)::integer from public.beverages), 1, 'Service can read beverages');
select is(pg_temp.affected_rows(
  $$update public.wines
       set name = 'Service tamper', updated_at = now()
     where key = 'fixture-wine'$$
), 0, 'Service cannot edit the wine catalogue');

-- Kitchen A: KDS/seat writes are required product behavior. Lifecycle and
-- destructive operations stay unavailable.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","email":"kitchen-a@test.invalid"}',
  true
);

select throws_ok(
  $$insert into public.services (id, workspace_id, date, session, started_at, status, updated_at)
    values ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', current_date, 'dinner', now(), 'live', now())$$,
  '42501'::character(5),
  null::text,
  'Kitchen cannot start a service'
);

select is(pg_temp.affected_rows(
  $$update public.service_tables
       set data = '{"courseReady":{"main":true}}', updated_at = now()
     where workspace_id = '20000000-0000-0000-0000-000000000001'
       and service_id = '30000000-0000-0000-0000-000000000001'
       and table_id = 1$$
), 1, 'Kitchen can persist KDS state');

select lives_ok(
  $$insert into public.reservations (id, workspace_id, date, table_id, data, created_at)
    values ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', current_date, 3, '{"resName":"Kitchen walk-in"}', now())$$,
  'Kitchen can seat a walk-in reservation'
);

select is(pg_temp.affected_rows(
  $$delete from public.reservations
     where id = '40000000-0000-0000-0000-000000000003'$$
), 0, 'Kitchen cannot delete reservations');

select lives_ok(
  $$insert into public.service_tables (workspace_id, service_id, table_id, data, updated_at)
    values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 2, '{"active":true}', now())$$,
  'Kitchen can create an offline-first board row for its restaurant'
);

select is(pg_temp.affected_rows(
  $$delete from public.service_tables
     where workspace_id = '20000000-0000-0000-0000-000000000001'
       and service_id = '30000000-0000-0000-0000-000000000004'
       and table_id = 2$$
), 0, 'Kitchen cannot delete board rows');

select is(pg_temp.affected_rows(
  $$update public.service_settings
       set state = '{"ids":[1]}', updated_at = now()
     where workspace_id = '20000000-0000-0000-0000-000000000001'
       and id = 'kitchen_ticket_order'$$
), 1, 'Kitchen can persist its ticket ordering setting');

select is((select count(*)::integer from public.menu_courses), 1, 'Kitchen can read menu courses');
select is((select count(*)::integer from public.wines), 1, 'Kitchen can read wines');
select is(pg_temp.affected_rows(
  $$delete from public.beverages
     where name = 'Fixture drink'$$
), 0, 'Kitchen cannot delete from the beverage catalogue');

select is((select count(*)::integer from public.services where workspace_id = '20000000-0000-0000-0000-000000000002'), 0, 'Kitchen cannot read restaurant B');

-- Service B has no path back into A, even though ids are known.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","email":"service-b@test.invalid"}',
  true
);

select is((select count(*)::integer from public.services), 1, 'restaurant B Service sees only B services');
select is((select count(*)::integer from public.reservations), 0, 'restaurant B Service sees no A reservations');
select is(pg_temp.affected_rows(
  $$update public.reservations
       set data = '{"resName":"Cross-tenant"}'
     where id = '40000000-0000-0000-0000-000000000001'$$
), 0, 'restaurant B Service cannot mutate a known A reservation id');

reset role;
select * from finish();
rollback;
