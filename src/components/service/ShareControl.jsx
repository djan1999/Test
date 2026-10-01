import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { shareMates, shareTag } from "../../utils/seatExtras.js";

const FONT = tokens.font;

// ShareControl — "who is splitting this?" as an explicit choice.
//
// The share used to be a button that scrolled ½P2 → ½P3 → … → off, so staff
// tapped blind until the right chair came round, could only ever pair two
// chairs, and overshooting meant going all the way round again. Now the
// button opens a row of the table's other chairs; each one toggles in or out
// of the share, the chairs already in it are filled, and the button reads
// exactly who is in it ("½ P2", "⅓ P2+P3").
//
// It renders a fragment — the button, and when open a full-width row — so a
// flex-wrap parent drops the picker onto its own line under the controls.
export default function ShareControl({
  seatId,
  seats = [],
  mates,
  onToggle,
  what = "",
  size = "md",
}) {
  const [open, setOpen] = useState(false);
  const others = (seats || []).filter((s) => s?.id !== seatId);
  if (others.length === 0) return null;
  const current = shareMates(mates);
  const active = current.length > 0;
  const small = size === "sm";
  const subject = what ? `${what} from P${seatId}` : `P${seatId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`Share ${subject}`}
        style={{
          fontFamily: FONT, fontSize: small ? 8 : 9, fontWeight: 700,
          padding: small ? "5px 5px" : "7px 8px", borderRadius: 0, cursor: "pointer", lineHeight: 1,
          border: `1px solid ${open ? tokens.charcoal.default : active ? tokens.neutral[500] : tokens.ink[4]}`,
          background: active ? tokens.tint.parchment : tokens.neutral[0],
          color: active ? tokens.neutral[700] : tokens.ink[3],
          touchAction: "manipulation", whiteSpace: "nowrap", letterSpacing: "0.04em",
        }}
      >{active ? shareTag(current) : small ? "½" : "SHARE"}</button>
      {open && (
        <div
          role="group"
          aria-label={`Share ${subject} with`}
          style={{
            flexBasis: "100%", width: "100%",
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
            padding: "6px 8px", marginTop: 2,
            border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50],
          }}
        >
          <span style={{
            fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase",
            color: tokens.ink[3], marginRight: 4,
          }}>
            {what ? `${what} · ` : ""}P{seatId} shares with
          </span>
          {others.map((s) => {
            const on = current.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                title={`${on ? "Stop sharing" : "Share"} ${subject} with P${s.id}`}
                onClick={() => onToggle && onToggle(s.id)}
                style={{
                  fontFamily: FONT, fontSize: 10, fontWeight: 700,
                  padding: "6px 10px", borderRadius: 0, cursor: "pointer", lineHeight: 1,
                  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
                  background: on ? tokens.charcoal.default : tokens.neutral[0],
                  color: on ? tokens.neutral[0] : tokens.ink[2],
                  touchAction: "manipulation",
                }}
              >{on ? "✓ " : ""}P{s.id}</button>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              padding: "6px 10px", borderRadius: 0, cursor: "pointer", lineHeight: 1,
              border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[3],
              marginLeft: "auto", touchAction: "manipulation",
            }}
          >DONE</button>
        </div>
      )}
    </>
  );
}
