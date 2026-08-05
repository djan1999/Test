# Support playbook — first-line triage for restaurant devices

Audience: whoever answers the phone when a restaurant reports a problem
mid-service. Keep this printable. Escalation contact: the platform operator.

## 1. "The tablet isn't updating" (sync appears stuck)

1. Check the device banner: offline vs connected. If offline, it is the
   venue's network — the app is designed to keep working; edits upload on
   reconnect. Do NOT clear anything.
2. If connected but stale: open Admin → SYSTEM on any admin device and check
   the client diagnostics list. Skipped/denied operations and CAS conflicts
   are recorded there with codes (e.g. `POWERSYNC_ZERO_MATCH`,
   `MILKA_CAS_EXHAUSTED`).
3. Only if a single device is genuinely wedged (uploads blocked in both
   directions): Admin → SYSTEM → **RESET LOCAL SYNC DB** on that device.
   **This discards that device's un-uploaded edits** — confirm the operator
   understands what was entered on that device since the problem began, and
   re-enter it afterwards. Never run it on more than one device at a time.

## 2. "We can't sign in"

- Password resets go through the login screen's recovery flow (email).
- If leaked-password protection rejects a known password at sign-in, the
  password appears in a public breach list — reset it; do not re-use it.
- Staff access is managed by the restaurant's own Admin (Admin → MEMBERS).
  The last Admin cannot be removed or demoted — that protection is intended.

## 3. Lost or stolen tablet

The tablet holds an unencrypted local copy of the restaurant's reservations
and guest dietary data.

1. Restaurant Admin removes/repoints the compromised staff account
   (Admin → MEMBERS → remove), which also cuts PowerSync's data stream for
   that login.
2. Platform operator revokes the account's sessions in Supabase Auth
   (dashboard → Authentication → Users → sign out user) and, if the login is
   shared across devices, forces a password reset.
3. Record the incident (date, device, account, action taken) — required for
   the restaurant's own GDPR incident log.

## 4. "The wine/beverage list is wrong or stale"

- Catalogue sync only runs for workspaces with a configured, approved
  provider; everyone else manages the catalogue manually in Admin.
- If a configured sync fails, the SYNC button surfaces the server's reason.
  A source-site outage never wipes the list (the server refuses empty
  replacements). Manual rows are never touched by sync.

## 5. After any production database restore

A restored database is OLDER than what every tablet remembers. Before
letting devices reconnect: follow the post-restore procedure in
DEPLOYMENT_RUNBOOK.md — every device needs RESET LOCAL SYNC DB after the
restore, and any edits made after the backup point are lost and must be
re-entered. Restoring without this step produces devices that disagree with
the server indefinitely.

## 6. When to escalate to the platform operator

- The same diagnostic code appears on multiple devices at once.
- Any suspicion of cross-restaurant data visibility (treat as a security
  incident: capture screenshots, note accounts and time, escalate
  immediately).
- Nightly catalogue sync failed twice in a row (check Vercel function logs).
- Anything requiring the Supabase dashboard: session revocation, backup
  restore, auth settings.
