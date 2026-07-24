-- Cover reservation-owned foreign keys reported by the staging advisor.
create index if not exists reservation_admin_audit_workspace_idx
  on public.reservation_admin_audit (workspace_id);
create index if not exists reservation_guests_merged_into_idx
  on public.reservation_guests (merged_into);
create index if not exists reservation_manage_tokens_booking_only_idx
  on public.reservation_manage_tokens (booking_id);
create index if not exists reservation_messages_workspace_booking_idx
  on public.reservation_messages (workspace_id, booking_id);
create index if not exists reservation_messages_booking_idx
  on public.reservation_messages (booking_id);
create index if not exists reservation_status_events_booking_only_idx
  on public.reservation_status_events (booking_id);
create index if not exists reservation_waitlist_converted_booking_idx
  on public.reservation_waitlist (converted_booking_id);
