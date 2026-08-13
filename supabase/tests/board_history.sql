-- Executable contract for the board history recorder, the worked-content
-- shield, and the time machine (migrations 20260808230000 and
-- 20260813080000 — the latter moves the shield onto the table itself).
-- Run with: supabase test db

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select no_plan();

-- Deterministic fixtures; the transaction rolls back at EOF.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-admin@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-service@test.invalid', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, name, slug, kind) values
  ('21000000-0000-0000-0000-000000000001', 'History Test', 'history-test', 'sandbox');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'admin'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'service');

insert into public.services (id, workspace_id, date, session, started_at, status, updated_at)
values ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
        current_date, 'dinner', now() - interval '3 hours', 'live', now());

-- ── the recorder ─────────────────────────────────────────────────────────────
-- A worked table: seated party with a fired course and seat drinks.
insert into public.service_tables (workspace_id, service_id, table_id, data, updated_at)
values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 1,
        '{"active":true,"resName":"Anna","seats":[{"id":1,"water":"STILL"},{"id":2,"water":"SPARKLING"}],"kitchenLog":{"c1":{"firedAt":"19:55"}}}',
        now() - interval '2 hours');

select is(
  (select count(*)::integer from public.service_tables_history
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  1,
  'the recorder captures the INSERT version'
);

update public.service_tables
   set data = jsonb_set(data, '{notes}', '"window seat"'), updated_at = now() - interval '1 hour'
 where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1;

select is(
  (select count(*)::integer from public.service_tables_history
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  2,
  'the recorder captures every UPDATE version'
);

-- A no-op UPDATE records nothing.
update public.service_tables
   set data = data
 where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1;
select is(
  (select count(*)::integer from public.service_tables_history
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  2,
  'an unchanged row records no version'
);

-- Pruning caps the history per key at 48 versions.
do $$
begin
  for i in 1..60 loop
    update public.service_tables
       set data = jsonb_set(data, '{notes}', to_jsonb('note ' || i)), updated_at = now()
     where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1;
  end loop;
end;
$$;
select is(
  (select count(*)::integer from public.service_tables_history
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  48,
  'per-key history is pruned to the newest 48 versions'
);

-- Mark the moment before the wipe below. (now() is frozen at transaction
-- start; history recorded_at uses clock_timestamp(), which advances.)
create temporary table t_marks(name text primary key, at timestamptz);
insert into t_marks values ('pre_clear', clock_timestamp());
grant select on t_marks to authenticated;

-- ── the worked-content shield ────────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","email":"history-service@test.invalid"}',
  true
);

-- A skeleton may not replace worked content without the attestation…
select throws_ok(
  $$select public.save_service_table_if_current(
      '21000000-0000-0000-0000-000000000001'::uuid,
      '31000000-0000-0000-0000-000000000001'::uuid,
      1,
      (select updated_at from public.service_tables
        where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
      '{"active":false,"resName":"Anna","seats":[]}'::jsonb,
      now(),
      false
    )$$,
  '23514'::character(5),
  null::text,
  'the shield refuses a worked-to-skeleton overwrite without attestation'
);

-- …and the pre-shield 6-arg signature is shielded STRICT, never a bypass.
select throws_ok(
  $$select public.save_service_table_if_current(
      '21000000-0000-0000-0000-000000000001'::uuid,
      '31000000-0000-0000-0000-000000000001'::uuid,
      1,
      (select updated_at from public.service_tables
        where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
      '{"active":false,"resName":"Anna","seats":[]}'::jsonb,
      now()
    )$$,
  '23514'::character(5),
  null::text,
  'the legacy signature carries the strict shield'
);

-- A deliberate clear WITH the attestation (the device saw the content) works.
select ok(
  (select public.save_service_table_if_current(
    '21000000-0000-0000-0000-000000000001'::uuid,
    '31000000-0000-0000-0000-000000000001'::uuid,
    1,
    (select updated_at from public.service_tables
      where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
    '{"active":false,"resName":"","seats":[]}'::jsonb,
    now(),
    true
  )),
  'an attested clear (allow_clear) passes the shield'
);

reset role;

-- ── the time machine ─────────────────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","email":"history-admin@test.invalid"}',
  true
);

-- The clear above wiped the table; restore to the pre-wipe marker.
select ok(
  (select public.restore_service_board(
    '21000000-0000-0000-0000-000000000001'::uuid,
    '31000000-0000-0000-0000-000000000001'::uuid,
    (select at from t_marks where name = 'pre_clear')
  ) >= 1),
  'the time machine rewrites the wiped table'
);

select is(
  (select data ->> 'resName' from public.service_tables
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  'Anna',
  'the restored row carries the pre-wipe party again'
);

select is(
  (select count(*)::integer from public.audit_log
    where workspace_id = '21000000-0000-0000-0000-000000000001'
      and entity_type = 'board_time_machine_restore'),
  1,
  'a restore is audited'
);

reset role;

-- ── the shield on the table itself (13.08 — no path around it) ───────────────
-- A direct UPDATE that skeletons a worked row — no RPC, no attestation, and
-- superuser privileges — is refused by the table trigger.
select throws_ok(
  $$update public.service_tables
       set data = '{"active":false,"resName":"","seats":[]}'::jsonb, updated_at = now()
     where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1$$,
  '23514'::character(5),
  null::text,
  'a direct skeleton-over-worked UPDATE is refused by the table itself'
);

-- A worked-to-worked direct edit is not the wipe shape and passes.
update public.service_tables
   set data = jsonb_set(data, '{notes}', '"direct edit"'), updated_at = now()
 where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1;
select is(
  (select data ->> 'notes' from public.service_tables
    where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1),
  'direct edit',
  'a worked-to-worked direct update passes the table shield'
);

-- The voucher is single-use: arm one through the assert, spend it on a
-- harmless write, and the very next wipe-shaped write is refused again.
select private.assert_worked_content_shield(null, '{}'::jsonb, true, 1);
update public.service_tables
   set data = jsonb_set(data, '{notes}', '"vouched edit"'), updated_at = now()
 where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1;
select throws_ok(
  $$update public.service_tables
       set data = '{"active":false,"resName":"","seats":[]}'::jsonb, updated_at = now()
     where service_id = '31000000-0000-0000-0000-000000000001' and table_id = 1$$,
  '23514'::character(5),
  null::text,
  'the voucher is consumed by the write it examined — the next wipe-shaped write is refused'
);

-- A non-admin may not restore.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","email":"history-service@test.invalid"}',
  true
);
select throws_ok(
  $$select public.restore_service_board(
      '21000000-0000-0000-0000-000000000001'::uuid,
      '31000000-0000-0000-0000-000000000001'::uuid,
      now()
    )$$,
  '42501'::character(5),
  null::text,
  'only an Admin can run the time machine'
);

-- Clients cannot write or purge the history.
select throws_ok(
  $$insert into public.service_tables_history(workspace_id, service_id, table_id, op, data)
    values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 1, 'update', '{}')$$,
  '42501'::character(5),
  null::text,
  'clients cannot forge history'
);
select throws_ok(
  $$delete from public.service_tables_history
     where workspace_id = '21000000-0000-0000-0000-000000000001'$$,
  '42501'::character(5),
  null::text,
  'clients cannot erase history'
);

reset role;

-- Purging the service (the deliberate forget) cascades through to history.
delete from public.service_tables where service_id = '31000000-0000-0000-0000-000000000001';
delete from public.services where id = '31000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.service_tables_history
    where service_id = '31000000-0000-0000-0000-000000000001'),
  0,
  'deleting the service takes its history with it (retention by design)'
);

select * from finish();
rollback;
