-- Executable contract for the append-only event log (migration 20260809010000).
-- Run with: supabase test db

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select no_plan();

-- DML inside assertion expressions goes through dynamic SQL returning the
-- affected-row count (same helper as pilot_role_matrix.sql).
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

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('12000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'log-service@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('12000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'log-outsider@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, name, slug, kind) values
  ('22000000-0000-0000-0000-000000000001', 'Log Test', 'log-test', 'sandbox');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'service');

insert into public.services (id, workspace_id, date, session, started_at, status, updated_at)
values ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001',
        current_date, 'dinner', now() - interval '2 hours', 'live', now());

-- ── members append and read ──────────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated","email":"log-service@test.invalid"}',
  true
);

select lives_ok(
  $$insert into public.service_events(workspace_id, service_id, event_id, device_id, actor_id, type, table_id, payload, client_ts)
    values ('22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
            '42000000-0000-0000-0000-000000000001', 'tablet-1',
            '12000000-0000-0000-0000-000000000001', 'course_fired', 3,
            '{"courseKey":"c2","firedAt":"19:55"}', now())$$,
  'a member appends a fact'
);

-- Idempotency: replaying the same event id appends nothing and errors nothing.
select is(
  pg_temp.affected_rows(
    $$insert into public.service_events(workspace_id, service_id, event_id, device_id, actor_id, type, table_id, payload)
      values ('22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
              '42000000-0000-0000-0000-000000000001', 'tablet-1',
              '12000000-0000-0000-0000-000000000001', 'course_fired', 3, '{}')
      on conflict (workspace_id, event_id) do nothing$$
  ),
  0,
  'replaying an offline queue cannot double-append'
);

-- A member may not sign a fact as someone else.
select throws_ok(
  $$insert into public.service_events(workspace_id, service_id, event_id, device_id, actor_id, type, payload)
    values ('22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
            '42000000-0000-0000-0000-000000000002', 'tablet-1',
            '12000000-0000-0000-0000-000000000002', 'course_fired', '{}')$$,
  '42501'::character(5),
  null::text,
  'an appended fact carries its true author'
);

-- A member cannot append an event naming another restaurant's service.
select throws_ok(
  $$insert into public.service_events(workspace_id, service_id, event_id, device_id, actor_id, type, payload)
    values ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dead',
            '42000000-0000-0000-0000-000000000009', 'tablet-1',
            '12000000-0000-0000-0000-000000000001', 'course_fired', '{}')$$,
  '23503'::character(5),
  null::text,
  'the composite FK rejects a cross-restaurant (or unknown) service reference'
);

-- ── the verbs UPDATE and DELETE do not exist ─────────────────────────────────
select throws_ok(
  $$update public.service_events set payload = '{"forged":true}'
     where event_id = '42000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'facts are never rewritten'
);
select throws_ok(
  $$delete from public.service_events
     where event_id = '42000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'facts are never erased by clients'
);

reset role;

-- ── an outsider sees and writes nothing ──────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-000000000002","role":"authenticated","email":"log-outsider@test.invalid"}',
  true
);
select is(
  (select count(*)::integer from public.service_events),
  0,
  'the log is invisible outside the workspace'
);
select throws_ok(
  $$insert into public.service_events(workspace_id, service_id, event_id, device_id, actor_id, type, payload)
    values ('22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
            '42000000-0000-0000-0000-000000000003', 'tablet-x',
            '12000000-0000-0000-0000-000000000002', 'course_fired', '{}')$$,
  '42501'::character(5),
  null::text,
  'an outsider cannot append into the workspace'
);
reset role;

-- ── retention: the deliberate purge still works ──────────────────────────────
-- The FK cascade arrives nested inside the FK's own trigger (depth > 1), so
-- the append-only guard lets the service take its facts with it.
delete from public.services where id = '32000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.service_events
    where service_id = '32000000-0000-0000-0000-000000000001'),
  0,
  'purging the service cascades through the log (retention by design)'
);

select * from finish();
rollback;
