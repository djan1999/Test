-- ── Attestation cannot excuse a template-over-worked write (19.08 T8) ────────
--
-- Production incident, 19.08 dinner, 22:09:27: a booking template — the SAME
-- party kept, flipped inactive, all staff work stripped — landed over four
-- hours of fires on table 8. Two things let it through:
--
--   · the writing device's synced baseline HELD the worked content (a stale
--     view raced adoption in front of a live board), so allow_clear was
--     derivable and the existing guard chain passed;
--   · the booking is a BIRTHDAY, so the template carries a celebration extra
--     seeded ordered:true straight from the reservation — and to
--     board_row_has_worked_content an ordered extra IS worked content, so the
--     wipe row never even classified as a clear. (Proven by replaying the
--     exact production row: the first draft of this rule, judged with the
--     worked-content predicate, let it straight through.)
--
-- So the shape is judged with a second predicate, board_row_has_staff_work —
-- worked-content MINUS the extras branch. Extras are the only field a
-- booking template can fake; everything else here can only enter through a
-- staff gesture during service. The shape itself is unforgeable: no real
-- gesture keeps the party, flips it inactive and strips its staff work in
-- one write. The surgical unseat keeps the work; CLEAR TABLE removes the
-- party; un-fires are incremental and leave the party seated and active.
-- Refused OUTRIGHT, attestation notwithstanding.
--
-- The Time Machine legitimately writes pre-arrival templates over worked
-- rows (rewinding to before a party arrived). It does not call this assert —
-- its writes travel on the shield voucher — so restores are unaffected.
--
-- The client mirrors both pieces in lib/serviceTableCas.js
-- (hasStaffEnteredWork + conflict "template-over-worked") and the vitest
-- fake backend emulates them — keep all three in lockstep.

create or replace function private.board_row_has_staff_work(d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select d is not null and coalesce((
    (jsonb_typeof(d -> 'kitchenLog') = 'object' and d -> 'kitchenLog' <> '{}'::jsonb)
    or (jsonb_typeof(d -> 'bottleWines') = 'array' and jsonb_array_length(d -> 'bottleWines') > 0)
    or (d ? 'kitchenSent' and d -> 'kitchenSent' not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb))
    or (d ? 'courseReady' and d -> 'courseReady' not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb))
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(d -> 'seats') = 'array' then d -> 'seats' else '[]'::jsonb end
        ) seat(s)
       where nullif(nullif(s ->> 'water', ''), '—') is not null
          or nullif(nullif(s ->> 'pairing', ''), '—') is not null
          or (jsonb_typeof(s -> 'aperitifs') = 'array' and jsonb_array_length(s -> 'aperitifs') > 0)
          or (jsonb_typeof(s -> 'glasses') = 'array' and jsonb_array_length(s -> 'glasses') > 0)
          or (jsonb_typeof(s -> 'cocktails') = 'array' and jsonb_array_length(s -> 'cocktails') > 0)
          or (jsonb_typeof(s -> 'spirits') = 'array' and jsonb_array_length(s -> 'spirits') > 0)
          or (jsonb_typeof(s -> 'beers') = 'array' and jsonb_array_length(s -> 'beers') > 0)
          or exists (
            select 1 from jsonb_each(
              case when jsonb_typeof(s -> 'optionalPairings') = 'object' then s -> 'optionalPairings' else '{}'::jsonb end
            ) op(k, v) where v -> 'ordered' = 'true'::jsonb
          )
    )
  ), false);
$$;

revoke all on function private.board_row_has_staff_work(jsonb) from public, anon;
grant execute on function private.board_row_has_staff_work(jsonb) to authenticated, service_role;

create or replace function private.assert_worked_content_shield(
  p_current jsonb,
  p_incoming jsonb,
  p_allow_clear boolean,
  p_table_id integer
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- The 19.08 shape: same party, flipped inactive, staff work stripped —
  -- judged extras-blind so a birthday template cannot disguise itself as
  -- worked content. No attestation can excuse it; a deliberate clear
  -- removes the party.
  if private.board_row_has_staff_work(p_current)
     and not private.board_row_has_staff_work(p_incoming)
     and nullif(btrim(coalesce(p_incoming->>'resName', '')), '') is not null
     and btrim(coalesce(p_incoming->>'resName', ''))
         = btrim(coalesce(p_current->>'resName', ''))
     and coalesce(p_incoming->'active', 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'Service table % holds worked content for this same party; a rebuild that keeps the party but drops its work was refused', p_table_id
      using errcode = '23514';
  end if;
  if not coalesce(p_allow_clear, false)
     and private.board_row_has_worked_content(p_current)
     and not private.board_row_has_worked_content(p_incoming) then
    raise exception 'Service table % holds worked content; a writer that has not synced it may not replace it with a skeleton', p_table_id
      using errcode = '23514';
  end if;
  -- The write this assert just cleared may proceed: vouch for THIS table's
  -- next update, transaction-local, consumed single-use by the trigger.
  perform set_config('milka.shield_vouch', coalesce(p_table_id::text, ''), true);
end;
$$;

revoke all on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) from public, anon;
grant execute on function private.assert_worked_content_shield(jsonb, jsonb, boolean, integer) to authenticated, service_role;
