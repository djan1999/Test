-- Reservation replacement functions (LAB / staging only).
--
-- All writes land in reservation_bookings. The trigger at the end maintains a
-- legacy-shaped projection in reservations so existing Service consumers keep
-- their current read contract. It never touches service_tables, service_settings,
-- floor maps, courses, KDS state, the service clock, or PowerSync rules.

begin;

create or replace function public.reservation_table_label(p_value text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(p_value), '') is null then null
    when trim(p_value) ~ '^[Tt][0-9]+$'
      then 'T' || lpad(regexp_replace(trim(p_value), '[^0-9]', '', 'g'), 2, '0')
    when trim(p_value) ~ '^[0-9]+$'
      then 'T' || lpad(trim(p_value), 2, '0')
    else trim(p_value)
  end
$$;

create or replace function public.reservation_booking_tables_of(
  p_table_label text,
  p_operational_data jsonb
) returns text[]
language sql
immutable
as $$
  select case
    when jsonb_typeof(coalesce(p_operational_data, '{}'::jsonb) -> 'tableGroup') = 'array'
      and jsonb_array_length(coalesce(p_operational_data, '{}'::jsonb) -> 'tableGroup') > 0
      then array(
        select public.reservation_table_label(value)
        from jsonb_array_elements_text(p_operational_data -> 'tableGroup') as values_(value)
      )
    when nullif(p_table_label, '') is not null
      then array[public.reservation_table_label(p_table_label)]
    else '{}'::text[]
  end
$$;

create or replace function public.reservation_booking_minutes(p_time text)
returns integer
language sql
immutable
as $$
  select coalesce(split_part(p_time, ':', 1)::integer * 60
    + split_part(p_time, ':', 2)::integer, 0)
$$;

create or replace function public.reservation_booking_hold_minutes(
  p_workspace uuid,
  p_pax integer
) returns integer
language sql
stable
as $$
  with settings as (
    select coalesce(config -> 'durations', '{}'::jsonb) as durations
    from public.reservation_config
    where workspace_id = p_workspace
  )
  select case
      when p_pax <= 2 then coalesce((select (durations ->> 'small')::integer from settings), 120)
      when p_pax <= 5 then coalesce((select (durations ->> 'medium')::integer from settings), 150)
      else coalesce((select (durations ->> 'large')::integer from settings), 180)
    end
    + coalesce((select (durations ->> 'buffer')::integer from settings), 15)
$$;

create or replace function public.reservation_booking_busy_tables(
  p_workspace uuid,
  p_date date,
  p_time text,
  p_pax integer,
  p_exclude uuid[] default '{}'::uuid[]
) returns text[]
language plpgsql
as $$
declare
  target_start integer := public.reservation_booking_minutes(p_time);
  target_end integer := target_start
    + public.reservation_booking_hold_minutes(p_workspace, p_pax);
  busy text[] := '{}';
  booking public.reservation_bookings;
  booking_start integer;
  booking_end integer;
begin
  for booking in
    select *
    from public.reservation_bookings
    where workspace_id = p_workspace
      and date = p_date
      and not (id = any(coalesce(p_exclude, '{}'::uuid[])))
      and status in ('pending', 'confirmed', 'arrived')
    order by id
    for update
  loop
    booking_start := public.reservation_booking_minutes(booking.booking_time::text);
    booking_end := booking_start
      + public.reservation_booking_hold_minutes(p_workspace, booking.pax);
    if target_start < booking_end and booking_start < target_end then
      busy := busy || public.reservation_booking_tables_of(
        booking.table_label,
        booking.operational_data
      );
    end if;
  end loop;
  return busy;
end
$$;

create or replace function public.save_reservation_booking_rows(
  p_workspace uuid,
  p_bookings jsonb,
  p_actor text default 'LAB STAFF'
) returns setof public.reservation_bookings
language plpgsql
as $$
declare
  item jsonb;
  booking_id uuid;
  existing public.reservation_bookings;
  saved public.reservation_bookings;
  excluded_ids uuid[];
  target_tables text[];
  busy_tables text[];
  conflict_tables text[];
  target_status text;
  target_source text;
  target_ref text;
begin
  if jsonb_typeof(p_bookings) <> 'array' or jsonb_array_length(p_bookings) = 0 then
    raise exception 'bookings_required';
  end if;

  select coalesce(array_agg((value ->> 'id')::uuid), '{}'::uuid[])
  into excluded_ids
  from jsonb_array_elements(p_bookings) as rows_(value)
  where nullif(value ->> 'id', '') is not null;

  perform 1
  from public.reservation_bookings
  where workspace_id = p_workspace and id = any(excluded_ids)
  order by id
  for update;

  for item in select value from jsonb_array_elements(p_bookings) as rows_(value)
  loop
    booking_id := coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid());
    select * into existing
    from public.reservation_bookings
    where workspace_id = p_workspace and id = booking_id;

    target_tables := public.reservation_booking_tables_of(
      item ->> 'tableLabel',
      coalesce(item -> 'operationalData', '{}'::jsonb)
    );
    busy_tables := public.reservation_booking_busy_tables(
      p_workspace,
      (item ->> 'date')::date,
      item ->> 'time',
      greatest(coalesce((item ->> 'pax')::integer, 1), 1),
      excluded_ids
    );
    select array_agg(table_name)
    into conflict_tables
    from unnest(target_tables) as requested(table_name)
    where table_name = any(busy_tables);
    if conflict_tables is not null then
      raise exception 'slot_taken'
        using hint = format('Table %s is occupied then.', array_to_string(conflict_tables, ', '));
    end if;

    target_status := coalesce(nullif(item ->> 'status', ''), existing.status, 'confirmed');
    target_source := coalesce(nullif(item ->> 'source', ''), existing.source, 'staff');
    if target_source not in ('staff', 'web', 'phone', 'walk_in', 'waitlist') then
      target_source := 'staff';
    end if;
    target_ref := coalesce(
      nullif(item ->> 'ref', ''),
      existing.ref,
      'MK-' || to_char(current_date, 'YYMMDD') || '-'
        || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
    );

    insert into public.reservation_bookings (
      id, workspace_id, date, service, booking_time, pax, status,
      guest_name, phone, email, language, source, ref, table_label,
      experience, occasion, notes, allergies, accessibility, consent_news,
      idempotency_key, created_by, operational_data, created_at, updated_at
    ) values (
      booking_id,
      p_workspace,
      (item ->> 'date')::date,
      coalesce(nullif(item ->> 'service', ''), 'dinner'),
      (item ->> 'time')::time,
      greatest(coalesce((item ->> 'pax')::integer, 1), 1),
      target_status,
      coalesce(nullif(trim(item ->> 'name'), ''), 'Reservation'),
      nullif(trim(item ->> 'phone'), ''),
      nullif(lower(trim(item ->> 'email')), ''),
      coalesce(nullif(item ->> 'language', ''), 'en'),
      target_source,
      target_ref,
      target_tables[1],
      nullif(item ->> 'experience', ''),
      nullif(item ->> 'occasion', ''),
      nullif(item ->> 'notes', ''),
      coalesce(item -> 'allergies', '[]'::jsonb),
      coalesce(item -> 'accessibility', '[]'::jsonb),
      coalesce((item ->> 'consentNews')::boolean, false),
      nullif(item ->> 'idempotencyKey', ''),
      coalesce(nullif(item ->> 'createdBy', ''), p_actor),
      jsonb_set(
        coalesce(item -> 'operationalData', '{}'::jsonb),
        '{tableGroup}',
        to_jsonb(target_tables),
        true
      ),
      coalesce(existing.created_at, now()),
      now()
    )
    on conflict (id) do update set
      date = excluded.date,
      service = excluded.service,
      booking_time = excluded.booking_time,
      pax = excluded.pax,
      status = excluded.status,
      guest_name = excluded.guest_name,
      phone = excluded.phone,
      email = excluded.email,
      language = excluded.language,
      source = excluded.source,
      table_label = excluded.table_label,
      experience = excluded.experience,
      occasion = excluded.occasion,
      notes = excluded.notes,
      allergies = excluded.allergies,
      accessibility = excluded.accessibility,
      consent_news = excluded.consent_news,
      operational_data = excluded.operational_data,
      updated_at = excluded.updated_at
    returning * into saved;

    insert into public.reservation_status_events (
      workspace_id, booking_id, actor, event_type, from_status, to_status, note
    ) values (
      p_workspace,
      saved.id,
      p_actor,
      case when existing.id is null then 'created' else 'modified' end,
      existing.status,
      saved.status,
      'Reservation workspace'
    );

    return next saved;
  end loop;
end
$$;

create or replace function public.delete_reservation_booking(
  p_workspace uuid,
  p_booking uuid,
  p_actor text default 'LAB STAFF'
) returns void
language plpgsql
as $$
declare
  current_row public.reservation_bookings;
begin
  select * into current_row
  from public.reservation_bookings
  where workspace_id = p_workspace and id = p_booking
  for update;
  if not found then
    raise exception 'not_found';
  end if;

  update public.reservation_waitlist
  set converted_booking_id = null, updated_at = now()
  where workspace_id = p_workspace and converted_booking_id = p_booking;

  delete from public.reservation_bookings
  where workspace_id = p_workspace and id = p_booking;

  insert into public.reservation_admin_audit (
    workspace_id, actor, section, field, old_value, new_value
  ) values (
    p_workspace,
    p_actor,
    'Reservations',
    'deleted booking',
    to_jsonb(current_row),
    null
  );
end
$$;

create or replace function public.swap_reservation_booking_tables(
  p_workspace uuid,
  p_a uuid,
  p_b uuid,
  p_actor text default 'LAB STAFF'
) returns setof public.reservation_bookings
language plpgsql
as $$
declare
  a public.reservation_bookings;
  b public.reservation_bookings;
  a_tables text[];
  b_tables text[];
begin
  perform 1
  from public.reservation_bookings
  where workspace_id = p_workspace and id = any(array[p_a, p_b])
  order by id
  for update;

  select * into a from public.reservation_bookings
  where workspace_id = p_workspace and id = p_a;
  select * into b from public.reservation_bookings
  where workspace_id = p_workspace and id = p_b;
  if a.id is null or b.id is null then raise exception 'not_found'; end if;
  if a.date <> b.date then raise exception 'different_dates'; end if;

  a_tables := public.reservation_booking_tables_of(a.table_label, a.operational_data);
  b_tables := public.reservation_booking_tables_of(b.table_label, b.operational_data);
  if array_length(a_tables, 1) is null or array_length(b_tables, 1) is null then
    raise exception 'nothing_to_swap';
  end if;

  update public.reservation_bookings
  set table_label = b_tables[1],
      operational_data = jsonb_set(operational_data, '{tableGroup}', to_jsonb(b_tables), true),
      updated_at = now()
  where workspace_id = p_workspace and id = p_a;

  update public.reservation_bookings
  set table_label = a_tables[1],
      operational_data = jsonb_set(operational_data, '{tableGroup}', to_jsonb(a_tables), true),
      updated_at = now()
  where workspace_id = p_workspace and id = p_b;

  insert into public.reservation_admin_audit (
    workspace_id, actor, section, field, old_value, new_value
  ) values (
    p_workspace,
    p_actor,
    'Reservations',
    'table swap',
    to_jsonb(a_tables) || to_jsonb(b_tables),
    to_jsonb(b_tables) || to_jsonb(a_tables)
  );

  return query
    select * from public.reservation_bookings
    where workspace_id = p_workspace and id = any(array[p_a, p_b])
    order by id;
end
$$;

create or replace function public.save_reservation_config(
  p_workspace uuid,
  p_config jsonb,
  p_changes jsonb default '[]'::jsonb,
  p_actor text default 'LAB STAFF'
) returns table(version integer, config jsonb)
language plpgsql
as $$
declare
  current_config jsonb;
  current_version integer;
  next_version integer;
  change_item jsonb;
begin
  if jsonb_typeof(coalesce(p_config, '{}'::jsonb)) <> 'object' then
    raise exception 'config_required';
  end if;

  select reservation_config.config, reservation_config.version
  into current_config, current_version
  from public.reservation_config
  where workspace_id = p_workspace
  for update;
  if not found then raise exception 'reservation_config_not_found'; end if;

  next_version := current_version + 1;
  update public.reservation_config
  set config = p_config,
      version = next_version,
      updated_at = now()
  where workspace_id = p_workspace;

  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 0 then
    for change_item in
      select value from jsonb_array_elements(p_changes) as changes_(value)
    loop
      insert into public.reservation_admin_audit (
        workspace_id, actor, section, field, old_value, new_value
      ) values (
        p_workspace,
        p_actor,
        coalesce(nullif(change_item ->> 'section', ''), 'Reservations'),
        coalesce(
          nullif(change_item ->> 'field', ''),
          nullif(change_item ->> 'label', ''),
          'configuration'
        ),
        case
          when change_item ? 'oldValue' then change_item -> 'oldValue'
          when change_item ? 'old' then change_item -> 'old'
          when change_item ? 'from' then change_item -> 'from'
          else null
        end,
        case
          when change_item ? 'newValue' then change_item -> 'newValue'
          when change_item ? 'next' then change_item -> 'next'
          when change_item ? 'to' then change_item -> 'to'
          else null
        end
      );
    end loop;
  else
    insert into public.reservation_admin_audit (
      workspace_id, actor, section, field, old_value, new_value
    ) values (
      p_workspace, p_actor, 'Reservations', 'configuration',
      current_config, p_config
    );
  end if;

  return query select next_version, p_config;
end
$$;

create or replace function public.save_reservation_admin_settings(
  p_workspace uuid,
  p_config jsonb,
  p_services jsonb,
  p_rules jsonb,
  p_changes jsonb default '[]'::jsonb,
  p_actor text default 'LAB STAFF'
) returns table(version integer, config jsonb)
language plpgsql
as $$
declare
  service_item jsonb;
  rule_item jsonb;
  saved_version integer;
  saved_config jsonb;
begin
  if jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array' then
    raise exception 'services_required';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'calendar_rules_required';
  end if;

  select result.version, result.config
  into saved_version, saved_config
  from public.save_reservation_config(
    p_workspace, p_config, p_changes, p_actor
  ) as result;

  delete from public.reservation_services
  where workspace_id = p_workspace;
  for service_item in
    select value from jsonb_array_elements(p_services) as services_(value)
  loop
    insert into public.reservation_services (
      id, workspace_id, service, weekday, enabled,
      first_seating, last_seating, interval_min, online_enabled,
      walkins_enabled, min_pax, max_pax, updated_at
    ) values (
      coalesce(nullif(service_item ->> 'id', '')::uuid, gen_random_uuid()),
      p_workspace,
      service_item ->> 'service',
      (service_item ->> 'weekday')::smallint,
      coalesce((service_item ->> 'enabled')::boolean, true),
      (service_item ->> 'first')::time,
      (service_item ->> 'last')::time,
      coalesce((service_item ->> 'interval')::integer, 30),
      coalesce((service_item ->> 'onlineEnabled')::boolean, true),
      coalesce((service_item ->> 'walkInsEnabled')::boolean, true),
      nullif(service_item ->> 'minPax', '')::integer,
      nullif(service_item ->> 'maxPax', '')::integer,
      now()
    );
  end loop;

  delete from public.reservation_calendar_rules
  where workspace_id = p_workspace;
  for rule_item in
    select value from jsonb_array_elements(p_rules) as rules_(value)
  loop
    insert into public.reservation_calendar_rules (
      id, workspace_id, date, kind, service, mode,
      first_seating, last_seating, interval_min, online_off,
      capacity, label, updated_at
    ) values (
      coalesce(nullif(rule_item ->> 'id', '')::uuid, gen_random_uuid()),
      p_workspace,
      (rule_item ->> 'date')::date,
      rule_item ->> 'kind',
      nullif(rule_item ->> 'service', ''),
      nullif(rule_item ->> 'mode', ''),
      nullif(rule_item ->> 'first', '')::time,
      nullif(rule_item ->> 'last', '')::time,
      nullif(rule_item ->> 'interval', '')::integer,
      coalesce((rule_item ->> 'onlineOff')::boolean, false),
      nullif(rule_item ->> 'capacity', '')::integer,
      nullif(rule_item ->> 'label', ''),
      now()
    );
  end loop;

  return query select saved_version, saved_config;
end
$$;

create or replace function public.project_reservation_booking()
returns trigger
language plpgsql
as $$
declare
  projected_data jsonb;
  projected_table integer;
  projected_tables text[];
begin
  if tg_op = 'DELETE' then
    delete from public.reservations
    where id = old.id and data ->> 'reservation_v2' = 'true';
    return old;
  end if;

  if new.status not in ('pending', 'confirmed', 'arrived') then
    delete from public.reservations
    where id = new.id and data ->> 'reservation_v2' = 'true';
    return new;
  end if;

  projected_tables := public.reservation_booking_tables_of(
    new.table_label,
    new.operational_data
  );
  projected_table := nullif(
    regexp_replace(coalesce(projected_tables[1], ''), '[^0-9]', '', 'g'),
    ''
  )::integer;
  projected_data := coalesce(new.operational_data, '{}'::jsonb)
    || jsonb_build_object(
      'reservation_v2', true,
      'booking_status', new.status,
      'service_session', new.service,
      'resName', new.guest_name,
      'resTime', to_char(new.booking_time, 'HH24:MI'),
      'guests', new.pax,
      'lang', new.language,
      'phone', coalesce(new.phone, ''),
      'email', coalesce(new.email, ''),
      'source', new.source,
      'ref', new.ref,
      'experience', coalesce(new.experience, ''),
      'occasion', coalesce(new.occasion, ''),
      'notes', coalesce(new.notes, ''),
      'restrictions', coalesce(new.allergies, '[]'::jsonb),
      'accessibility', coalesce(new.accessibility, '[]'::jsonb),
      'consentNews', new.consent_news,
      'tableGroup', to_jsonb(array(
        select nullif(regexp_replace(label, '[^0-9]', '', 'g'), '')::integer
        from unnest(projected_tables) as labels(label)
      ))
    );

  insert into public.reservations (
    id, workspace_id, date, table_id, data, created_at
  ) values (
    new.id, new.workspace_id, new.date, projected_table,
    projected_data, new.created_at
  )
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    date = excluded.date,
    table_id = excluded.table_id,
    data = excluded.data;

  return new;
end
$$;

drop trigger if exists reservation_bookings_project_legacy
  on public.reservation_bookings;
create trigger reservation_bookings_project_legacy
after insert or update or delete on public.reservation_bookings
for each row execute function public.project_reservation_booking();

-- Populate the compatibility read model for bookings created before this
-- trigger existed. The no-op assignment deliberately fires the trigger.
update public.reservation_bookings
set updated_at = updated_at;

revoke all on function public.reservation_table_label(text) from public, anon, authenticated;
revoke all on function public.reservation_booking_tables_of(text, jsonb) from public, anon, authenticated;
revoke all on function public.reservation_booking_minutes(text) from public, anon, authenticated;
revoke all on function public.reservation_booking_hold_minutes(uuid, integer) from public, anon, authenticated;
revoke all on function public.reservation_booking_busy_tables(uuid, date, text, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.save_reservation_booking_rows(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.delete_reservation_booking(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.swap_reservation_booking_tables(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_reservation_config(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_reservation_admin_settings(uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.reservation_table_label(text) to service_role;
grant execute on function public.reservation_booking_tables_of(text, jsonb) to service_role;
grant execute on function public.reservation_booking_minutes(text) to service_role;
grant execute on function public.reservation_booking_hold_minutes(uuid, integer) to service_role;
grant execute on function public.reservation_booking_busy_tables(uuid, date, text, integer, uuid[]) to service_role;
grant execute on function public.save_reservation_booking_rows(uuid, jsonb, text) to service_role;
grant execute on function public.delete_reservation_booking(uuid, uuid, text) to service_role;
grant execute on function public.swap_reservation_booking_tables(uuid, uuid, uuid, text) to service_role;
grant execute on function public.save_reservation_config(uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.save_reservation_admin_settings(uuid, jsonb, jsonb, jsonb, jsonb, text) to service_role;

alter function public.reservation_table_label(text) set search_path = '';
alter function public.reservation_booking_tables_of(text, jsonb) set search_path = '';
alter function public.reservation_booking_minutes(text) set search_path = '';
alter function public.reservation_booking_hold_minutes(uuid, integer) set search_path = '';
alter function public.reservation_booking_busy_tables(uuid, date, text, integer, uuid[]) set search_path = '';
alter function public.save_reservation_booking_rows(uuid, jsonb, text) set search_path = '';
alter function public.delete_reservation_booking(uuid, uuid, text) set search_path = '';
alter function public.swap_reservation_booking_tables(uuid, uuid, uuid, text) set search_path = '';
alter function public.save_reservation_config(uuid, jsonb, jsonb, text) set search_path = '';
alter function public.save_reservation_admin_settings(uuid, jsonb, jsonb, jsonb, jsonb, text) set search_path = '';
alter function public.project_reservation_booking() set search_path = '';

commit;
