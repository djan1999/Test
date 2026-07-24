-- Exact LAB rollback for the 20260724 reservation replacement migrations.
-- Existing reservation core tables and every Service-owned object remain.

begin;

drop trigger if exists reservation_bookings_project_legacy
  on public.reservation_bookings;

drop function if exists public.project_reservation_booking();
drop function if exists public.swap_reservation_booking_tables(uuid, uuid, uuid, text);
drop function if exists public.delete_reservation_booking(uuid, uuid, text);
drop function if exists public.save_reservation_booking_rows(uuid, jsonb, text);
drop function if exists public.reservation_booking_busy_tables(uuid, date, text, integer, uuid[]);
drop function if exists public.reservation_booking_hold_minutes(uuid, integer);
drop function if exists public.reservation_booking_minutes(text);
drop function if exists public.reservation_booking_tables_of(text, jsonb);
drop function if exists public.reservation_table_label(text);

delete from public.reservations
where data ->> 'reservation_v2' = 'true';

drop index if exists public.reservation_bookings_operational_data_idx;
drop table if exists public.reservation_capacity_rules;

alter table public.reservation_services
  drop column if exists walkins_enabled,
  drop column if exists min_pax,
  drop column if exists max_pax;

alter table public.reservation_bookings
  drop column if exists operational_data;

commit;
