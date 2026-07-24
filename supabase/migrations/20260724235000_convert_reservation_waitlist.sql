-- Convert a waitlist entry and create its booking in one database transaction.
-- Reservation-owned tables only; no Service mutation is performed here.

begin;

create or replace function public.convert_reservation_waitlist(
  p_workspace uuid,
  p_waitlist uuid,
  p_booking jsonb,
  p_actor text default 'LAB STAFF'
) returns public.reservation_bookings
language plpgsql
as $$
declare
  current_entry public.reservation_waitlist;
  saved public.reservation_bookings;
begin
  select * into current_entry
  from public.reservation_waitlist
  where workspace_id = p_workspace
    and id = p_waitlist
    and status in ('waiting', 'contacted')
  for update;

  if not found then
    raise exception 'waitlist_not_available';
  end if;

  select * into saved
  from public.save_reservation_booking_rows(
    p_workspace,
    jsonb_build_array(p_booking),
    p_actor
  )
  limit 1;

  if saved.id is null then
    raise exception 'booking_not_created';
  end if;

  update public.reservation_waitlist
  set status = 'converted',
      converted_booking_id = saved.id,
      updated_at = now()
  where workspace_id = p_workspace
    and id = p_waitlist;

  return saved;
end
$$;

revoke all on function public.convert_reservation_waitlist(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.convert_reservation_waitlist(uuid, uuid, jsonb, text)
  to service_role;

commit;
