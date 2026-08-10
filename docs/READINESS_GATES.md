# Five gates to the second restaurant

The test: **a restaurant that had nothing to do with building this receives an
account and runs a service on it.** Nobody from the project is in the room, and
nobody touches the database.

This file is the honest state of that. It is not a plan document — the plans
live in `PILOT_ROLLOUT.md`, `DEPLOYMENT_RUNBOOK.md` and
`READINESS_REVIEW_2026-08.md`. This is the tracker that says which of the five
gates is closed, and exactly what is still holding each open.

Status vocabulary, used strictly:

- **Closed** — done, with evidence recorded in this repository.
- **Code complete** — the software exists and is tested; something outside the
  code (real infrastructure, real hardware, a signature) is still required.
- **Open** — not done.

A gate is closed only when every line under it is closed. Today: **no gate is
closed.**

---

## Gate A — Security

| Item | Status | What is actually true |
|---|---|---|
| Tenant isolation verification | Code complete | `supabase/tests/pilot_role_matrix.sql` — 64 assertions executed against a real Postgres branch (2026-08-05), including cross-workspace denial and the two-step purge path. Never reviewed by anyone outside this project (see Gate E). |
| Roles / permissions | Code complete | Three roles enforced in Postgres RLS and mirrored in `src/auth/roles.js`; matrix in `PILOT_ROLLOUT.md`. Production has only ever held Admin memberships, so Service and Kitchen are untested by real use. The setup checklist now flags a restaurant running its kitchen on an Admin login. |
| Password / security settings | **Open** | Supabase leaked-password protection is still off. One dashboard toggle, unchecked in `PILOT_ROLLOUT.md`, and it is the only thing standing between a breached password and a working login. |
| Audit logs | Code complete | `audit_log` + Admin → Audit Trail, with snapshot/state redaction. Known hole: `capture_admin_audit` skips when `auth.uid()` is null, so service-role writes (cron, operator tooling) leave no trace. |
| Backup / recovery | **Open** | No production backup has been restored into an isolated project and verified. This is the first evidence box in `PILOT_ROLLOUT.md` and it is unsigned. The *client-side* half is written: `SUPPORT_PLAYBOOK.md` §5 covers the post-restore device reset that a restore without it would get wrong. |
| GDPR retention policy | **Open** | `DATA_RETENTION_POLICY_DRAFT.md` exists and is a draft. Nobody has signed the numbers, and nothing enforces them — retention is a quarterly manual purge that has never happened. |
| Privacy documentation | **Open** | No privacy notice exists in this repository. |
| DPA structure | **Open** | The sub-processor chain is identified (Supabase, Vercel, PowerSync/JourneyApps). No DPA is recorded for any of them. |
| External security review | **Open** | Not commissioned. |

**What closes this gate first:** the leaked-password toggle and the restore
drill. Both are hours of work against real infrastructure, and both are
prerequisites the paperwork items depend on.

---

## Gate B — Reliability

`SERVICE_DRILLS.md` holds drills A–K plus a PowerSync-outage fallback drill.
`INVARIANTS.md` records the thing that matters most about them: **they have
never been run on real tablets.**

Against the scenarios that must be tested brutally:

| Scenario | Drill | Status |
|---|---|---|
| Internet disconnects | B | Written, unrun on hardware |
| Supabase outage | Fallback | Written for a PowerSync outage; a full Supabase outage is a different failure and is not drilled |
| PowerSync reconnect | B, C | Written, unrun on hardware |
| Browser reload | D | Written, unrun on hardware |
| Device reboot | — | **Not drilled** |
| Two people editing simultaneously | H | Written; the deliberate rule (same seat → last write wins) is documented |
| 20+ reservations | — | **Not drilled** — no load drill of any kind exists |
| Full restaurant | — | **Not drilled** |
| Many kitchen tickets | — | **Not drilled** |
| Stale device returning after hours | C, J | Written, unrun on hardware |
| Accidental double clicks | — | **Not drilled** |
| iPad sleep / wake | — | **Not drilled** |
| Kitchen display restart | — | **Not drilled** (D covers cold start, not a restart mid-service) |

Seven scenarios have no drill. Drills L–R in `SERVICE_DRILLS.md` now specify
them; none has been executed.

**"Document every failure"** has no home until now: `FAILURE_LOG.md` is the
register. It is empty, which currently means *untested*, not *clean*, and it
should not be read as evidence of anything until drills have run against it.

**What closes this gate:** two tablets, a kitchen display, and a night. Nothing
in this list can be closed from a repository.

---

## Gate C — Onboarding

The sequence a second restaurant must complete without a database client:

create restaurant → floor → tables → courses → staff → permissions → menu →
service configuration → operate.

| Step | Where it happens | Status |
|---|---|---|
| Create restaurant | `npm run onboard:restaurant` (operator, service key, dry-run by default) | Code complete — deliberately **not** self-serve. Minting a tenant is an operator action; the restaurant receives a working account, it does not create one. |
| Floor | Admin → Floor & Terrace | Closed |
| Tables | Admin → Restaurant Setup | Closed |
| Courses | Admin → Menu Layout | Closed |
| Staff | Admin → Staff & Roles (email invitation) | Closed |
| Permissions | Admin → Staff & Roles (Admin / Service / Kitchen) | Closed |
| Menu | Admin → Menu Layout | Closed |
| Service configuration | Admin → Restaurant Setup, Dishes & Restrictions | Closed |
| **Knowing what is left** | Admin → Setup Checklist | Closed |

Every panel already existed. What did not exist was any way for an admin who
had never met this system to know the order, or when they were finished — the
gap that made "you currently understand how to configure everything" the whole
problem. Admin now opens on a checklist computed from the workspace's own data:
eight steps, each either done, worth checking, or blocking the first service,
each with the one action that fixes it. Nothing is stored, so it cannot drift
away from what the restaurant actually has.

It distinguishes two things carefully, because blurring them makes the screen
worth ignoring:

- **BLOCKS** — the first service genuinely breaks. A configured table with no
  place on the active floor layout would render dead mid-service: no seats, no
  kitchen status. Hotel mode with no rooms listed gives every reservation an
  empty room picker. Courses that still read "Course 1, Course 2" reach guests.
- **CHECK** — advice. Ten tables still labelled T01–T10 is a legitimate
  configuration for a ten-table restaurant, and never blocks.

**What is still open:** the flow has not been walked end-to-end by someone
outside the project. That walk *is* Gate C's test, and it is the cheapest
remaining item in this whole document.

---

## Gate D — Support

> The restaurant calls at 20:05, mid-service, and says the kitchen screen isn't
> updating. What happens?

| Piece | Status |
|---|---|
| Diagnostics | Closed — `src/lib/deviceHealth.js` reads network, stream, first-sync, last-sync, service state and refused operations together and returns one verdict |
| Error logging | Closed — `clientDiagnostics.js` records refusals and crashes on-device, with tokens redacted |
| Admin health information | Closed — Admin → System leads with the same readout |
| Recovery instructions | Closed — `SUPPORT_PLAYBOOK.md`, and the readout carries the single next action |
| Emergency procedures | Closed — `SUPPORT_PLAYBOOK.md` §3, §5; `DEPLOYMENT_RUNBOOK.md` rollback |
| Operator-side visibility | **Open** — diagnostics never leave the device |

What now happens at 20:05: whoever is at the pass taps **?** beside the status
chip. That button exists on every operating screen, including the kitchen
display, because the Kitchen role cannot open Admin at all — an answer only
reachable from Admin is not an answer at 20:05. They read the first line down
the phone.

The six answers, and why each is a different phone call:

- **This device is offline** — the venue network. Everything typed here is
  saved and will upload by itself. *Do not reset anything*: a reset would throw
  away exactly those edits.
- **Still receiving its first copy** — wait a minute, then reload once.
- **Connected, but not receiving** — the stream is up and silent, or erroring;
  the readout quotes the engine's own error. Reload once; if a second device
  says the same, it is the service, not the device.
- **Operations are being refused** — the only class that loses an edit. Write
  down what was entered here, then escalate before clearing anything.
- **Healthy — no service running** — at 20:05 this usually means nobody pressed
  START. The kitchen goes live by itself when the floor starts.
- **This device is healthy** — the important one. The change never left the
  *other* device. A triage tool that cannot say "the problem is somewhere else"
  sends people to clear local databases that were never broken, and
  RESET LOCAL SYNC DB destroys work.

Every verdict also prints one identifying line — state, build, role,
restaurant, timestamp — that can be read aloud or screenshotted, and that
contains no guest data.

**What is still open:** the operator cannot see any of this remotely. Every
diagnosis depends on someone at the restaurant reading a screen. That is
acceptable for one pilot restaurant and stops being acceptable at three.

---

## Gate E — Data

Restaurant A can never see Restaurant B.

| Layer | Status |
|---|---|
| Postgres RLS on every tenant table | Code complete |
| `workspace_id` on every row; `scopedFrom()` on every client read/write | Code complete |
| PowerSync sync rules filtered by membership | Code complete |
| Composite `services (workspace_id, id)` FK | Code complete |
| Executable cross-tenant contract | Code complete — 64 pgTAP assertions against real Postgres |
| **Independent review** | **Open** |

Everything here was designed, written and verified by the same effort. The
tests pass because they encode the same understanding of the system that built
it, which is precisely the failure mode an independent reviewer exists to
catch. Nothing in the evidence above distinguishes "isolation is correct" from
"isolation is consistently misunderstood".

This is the one place where an outside opinion is not a formality, and it
should be commissioned against the database and the sync rules together — a
correct RLS policy and a leaky sync rule produce the same green test suite.

---

## Where this stands

Gates C and D moved because they were software problems, and software is what
this repository can close by itself.

Gates A, B and E cannot be closed here, and that is not a scheduling
observation — it is what they are. Gate A ends in signatures and a security
firm. Gate B ends on a real kitchen display at 20:00 on a real Friday. Gate E
ends with someone who was never told how this was supposed to work trying to
read Restaurant A's data as Restaurant B.

The next cheapest step in the entire document is Gate C's: hand the checklist
to somebody outside this project and watch where they stop.
