# Separate Demo test account

Demo is an ordinary sandbox restaurant. It must use a different Supabase Auth
login from Milka and must have no Milka membership. Existing Demo data remains
under the Demo `workspace_id`; changing the login does not copy or delete it.

## One-time setup before deployment

1. In Supabase Dashboard → Authentication → Users, create a dedicated Demo
   email/password user and auto-confirm it. Use a password that is not shared
   with the Milka login.
2. Copy the new user's UUID.
3. In SQL Editor, replace `DEMO_USER_UUID` below and run:

```sql
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'DEMO_USER_UUID'::uuid, 'owner'
from public.workspaces
where slug = 'demo'
on conflict (workspace_id, user_id)
do update set role = excluded.role;
```

4. Verify the two accounts are isolated:

```sql
select w.slug, u.email, m.user_id
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
join auth.users u on u.id = m.user_id
where w.slug in ('milka', 'demo')
order by w.slug, u.email;
```

The Demo user must appear only beside `demo`; the Milka login must appear only
beside `milka`. Do not add either login to the other workspace.

5. Apply all repository migrations, deploy the PowerSync rules, then deploy
   the web app. The final migration removes `platform_admins`; an old master
   login with no explicit membership will then see no restaurant data.

## Testing

Sign into Demo on both test devices and use only fake names/reservations. Manual
catalog sync now targets the currently active workspace, so pressing Sync in
Demo changes Demo only; scheduled cron sync remains fixed to Milka.

Run every drill in `docs/SERVICE_DRILLS.md` before deploying the same build to
live service. Switching Supabase users automatically clears the previous
account's on-device PowerSync database before reconnecting.
