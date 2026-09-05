# Failure log

Every failure found while drilling this system, on real hardware, with the date
it was found and what happened to it afterwards.

**An empty log means untested, not clean.** Do not cite this file as evidence
of reliability until the drills it records have actually been run. A drill that
passes first time and is never written down is indistinguishable from a drill
nobody ran.

## How to use it

One row per failure, not per drill. A drill that surfaces three problems gets
three rows. Record cosmetic failures too — a button that reads the wrong label
under load is a real finding, and the judgement about whether it matters is
made later, by someone who can see the whole list.

Write the row **when it fails**, before fixing it. A failure fixed within the
same hour and never recorded is the most expensive kind: the next person meets
it again and has no way to know it was ever understood.

Fill in what you know. An unresolved cause is a legitimate row — `cause: not
established` is information, and a pattern of them in one area is a finding in
itself.

| Field | Meaning |
|---|---|
| Date | When it was observed |
| Drill | Drill letter, or "live service" / "ad hoc" |
| Device | The actual hardware and OS version, not "a tablet" |
| What happened | Observable behaviour, in the words someone at the pass would use |
| Impact | What a restaurant would have lost or got wrong |
| Cause | Root cause once established, or "not established" |
| Resolution | Commit, config change, documented workaround, or "open" |
| Recurred | Whether it has been seen again since |

## Log

| Date | Drill | Device | What happened | Impact | Cause | Resolution | Recurred |
|---|---|---|---|---|---|---|---|
| — | — | — | *No drills have been executed on real hardware yet.* | — | — | — | — |

## Standing failures accepted by design

These are not bugs, and they are listed here so nobody logs them twice and
nobody discovers them during a service.

| Behaviour | Why it is accepted |
|---|---|
| Two devices editing the **same seat** at the same moment: the last committed edit wins | Different-seat edits on the same table are merged and preserved. Only an exact same-seat collision resolves by last-write, and the loser is deliberate rather than silent — see Drill H. |
| A device offline for a long stretch shows stale data until it reconnects | Local-first by design. The device keeps working and uploads on reconnect; the status chip and the **?** readout both say so. |
| RESET LOCAL SYNC DB discards that device's un-uploaded edits | It is the wedge-recovery tool of last resort, and the loss is the point. The support playbook requires establishing what was entered before it is run. |
| Restoring the database leaves every tablet ahead of the server | Unavoidable with a point-in-time restore. `SUPPORT_PLAYBOOK.md` §5 requires resetting every device afterwards; skipping it produces tablets that disagree with the server indefinitely. |
