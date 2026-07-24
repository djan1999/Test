-- One-way staff access-code gate used only by the isolated Edge Function.
-- The plaintext code is never stored in Postgres.
create table if not exists public.reservation_lab_auth (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  access_code_hash text not null check (length(access_code_hash) = 64),
  updated_at timestamptz not null default now()
);

alter table public.reservation_lab_auth enable row level security;
revoke all on table public.reservation_lab_auth from anon, authenticated;
grant all on table public.reservation_lab_auth to service_role;

insert into public.reservation_lab_auth (workspace_id, access_code_hash)
select id, '2e8ed6be7b85c2141a4154a9504044a35e65570eb3fd28a5f7669a6e898848f5'
from public.workspaces
where slug = 'milka-reservations-lab'
on conflict (workspace_id) do update
set access_code_hash = excluded.access_code_hash,
    updated_at = now();
