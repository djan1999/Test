import { useCallback, useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";
import { evaluateSetup, STATUS } from "../../lib/setupReadiness.js";
import { requestWorkspaceMembers } from "../../lib/workspaceMembers.js";

// ── SetupChecklistPanel — the first screen a brand-new restaurant sees ──────
// Reads the workspace's own data and says, in order, what is still missing
// before a first service. Nothing here is stored: every line is recomputed
// from the same rows the operating screens read, so it cannot drift out of
// agreement with reality the way a ticked box would.
//
// The staff list is fetched here rather than threaded down through the admin
// shell — it lives behind the members API, not in the synced tables, and the
// checklist is the only other surface that needs it.

const CHIP = {
  [STATUS.DONE]:      { label: "DONE",    bg: tokens.green.bg,   border: tokens.green.border, text: tokens.green.text },
  [STATUS.ATTENTION]: { label: "CHECK",   bg: tokens.neutral[0], border: tokens.signal.warn,  text: tokens.signal.warn },
  [STATUS.BLOCKED]:   { label: "BLOCKS",  bg: tokens.red.bg,     border: tokens.red.border,   text: tokens.red.text },
  [STATUS.UNKNOWN]:   { label: "—",       bg: tokens.neutral[0], border: tokens.ink[4],       text: tokens.ink[3] },
};

export default function SetupChecklistPanel({
  restaurantConfig = null,
  floorMaps = null,
  menuCourses = null,
  restrictionsList = null,
  accessToken = null,
  workspaceId = null,
  onNavigate = null,
}) {
  // null = not loaded yet (steps show as unknown rather than claiming a state
  // we cannot see); an array = the real membership list.
  const [members, setMembers] = useState(null);
  const [membersError, setMembersError] = useState("");

  const loadMembers = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    try {
      const data = await requestWorkspaceMembers({ accessToken, workspaceId });
      setMembers(Array.isArray(data?.members) ? data.members : []);
      setMembersError("");
    } catch (error) {
      // A failed staff read must not blank the other seven steps.
      setMembersError(error?.message || "The staff list could not be read.");
    }
  }, [accessToken, workspaceId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const { steps, ready, headline, blocking } = evaluateSetup({
    restaurantConfig, floorMaps, menuCourses, members, restrictionsList,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{
          fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 2,
          color: tokens.ink[0], textTransform: "uppercase", marginBottom: 8,
        }}>
          Setup checklist
        </div>
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], lineHeight: 1.6, maxWidth: 720 }}>
          Everything a new restaurant needs before its first service, in order. Each line is read
          from this restaurant's own configuration every time this screen opens — there is nothing
          to tick off by hand.
        </div>
      </div>

      {/* Verdict. One sentence, readable across a room. */}
      <div
        role="status"
        style={{
          fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: 1.5,
          padding: "14px 18px", textTransform: "uppercase",
          border: `1px solid ${ready ? tokens.green.border : tokens.red.border}`,
          background: ready ? tokens.green.bg : tokens.red.bg,
          color: ready ? tokens.green.text : tokens.red.text,
        }}
      >
        {headline}
      </div>

      {membersError && (
        <div role="alert" style={{
          fontFamily: FONT, fontSize: 10, color: tokens.ink[2], lineHeight: 1.6,
          padding: "10px 14px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0],
        }}>
          Staff steps could not be checked: {membersError}
        </div>
      )}

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {steps.map((step) => {
          const chip = CHIP[step.status] || CHIP[STATUS.UNKNOWN];
          return (
            <li
              key={step.id}
              style={{
                display: "flex", gap: 14, alignItems: "flex-start",
                padding: "14px 16px", background: tokens.neutral[0],
                border: `1px solid ${tokens.ink[4]}`,
                borderLeft: `3px solid ${step.status === STATUS.BLOCKED ? tokens.red.border
                  : step.status === STATUS.DONE ? tokens.green.border : tokens.ink[4]}`,
              }}
            >
              <span style={{
                fontFamily: FONT, fontSize: 10, color: tokens.ink[3],
                minWidth: 18, paddingTop: 2, fontWeight: 600,
              }}>{step.order}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{
                    fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: 1.4,
                    color: tokens.ink[0], textTransform: "uppercase",
                  }}>{step.title}</span>
                  <span style={{
                    fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "3px 8px",
                    border: `1px solid ${chip.border}`, background: chip.bg, color: chip.text,
                    fontWeight: 600,
                  }}>{chip.label}</span>
                </div>

                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], lineHeight: 1.6 }}>
                  {step.summary}
                </div>

                {step.action && (
                  <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], lineHeight: 1.6, marginTop: 6 }}>
                    → {step.action}
                  </div>
                )}
              </div>

              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.section)}
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1.4, padding: "8px 14px",
                    border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                    background: tokens.neutral[0], color: tokens.ink[0],
                    flexShrink: 0, minHeight: 44, touchAction: "manipulation",
                  }}
                >OPEN</button>
              )}
            </li>
          );
        })}
      </ol>

      {!ready && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], lineHeight: 1.6, maxWidth: 720 }}>
          A BLOCKS line means a real failure during service — a party with nowhere to sit, a kitchen
          with nothing to fire. A CHECK line is advice: the restaurant can trade without it.
          {blocking.length > 0 && ` Start with “${blocking[0].title}”.`}
        </div>
      )}
    </div>
  );
}
