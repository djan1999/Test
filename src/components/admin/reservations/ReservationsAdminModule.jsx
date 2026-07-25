import { useCallback, useEffect, useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import {
  getLabAccessCode,
  loadStaffState,
  seedReservationLab,
  staffAction,
} from "../../../reservations-lab/reservationClient.js";
import ReservationsAdminPanel from "./ReservationsAdminPanel.jsx";

const displayAuditValue = (value) => {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  } catch {
    return String(value);
  }
};

export default function ReservationsAdminModule({ accessToken, workspaceId, floorMaps = null }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const credentials = useMemo(() => (
    accessToken && workspaceId
      ? { accessToken, workspaceId }
      : getLabAccessCode()
  ), [accessToken, workspaceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await loadStaffState(credentials);
      setState(payload.state);
      setError("");
      return payload.state;
    } catch (requestError) {
      setError(requestError?.message || "Reservation settings could not be loaded.");
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [credentials]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadStaffState(credentials)
      .then((payload) => {
        if (!active) return;
        setState(payload.state);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError?.message || "Reservation settings could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [credentials]);

  const save = useCallback(async ({
    config,
    weeklyServices,
    exceptions,
    changes,
  }) => {
    await staffAction("saveAdminSettings", {
      config,
      services: weeklyServices,
      rules: exceptions,
      changes,
    }, credentials);
    await refresh();
  }, [credentials, refresh]);

  // The LAB seeding button only exists if the build asked for it. The server
  // refuses anyway unless it is the LAB workspace with seeding switched on —
  // this flag only decides whether the button is worth rendering.
  const seedLab = useMemo(() => (
    import.meta.env.VITE_RESERVATIONS_LAB_TOOLS_ENABLED === "true"
      ? async (options) => {
        const result = await seedReservationLab(options, credentials);
        await refresh();
        return result.summary;
      }
      : null
  ), [credentials, refresh]);

  const audit = useMemo(() => (state?.audit || []).map((row) => ({
    id: row.id,
    at: row.occurred_at
      ? new Date(row.occurred_at).toLocaleString()
      : "",
    actor: row.actor || "Milka",
    section: row.section || "Reservations",
    from: displayAuditValue(row.old_value),
    to: displayAuditValue(row.new_value),
  })), [state?.audit]);

  if (loading && !state) {
    return <div style={{ fontSize: 11, color: tokens.ink[3] }}>Loading reservation settings…</div>;
  }

  if (!state) {
    return (
      <section>
        <div role="alert" style={{
          padding: 14,
          border: `1px solid ${tokens.red.border}`,
          background: tokens.red.bg,
          color: tokens.red.text,
          fontSize: 11,
          lineHeight: 1.55,
        }}>
          {error || "Reservation settings are unavailable."}
        </div>
        <button
          type="button"
          onClick={() => refresh().catch(() => {})}
          style={{
            marginTop: 10,
            minHeight: 40,
            padding: "8px 14px",
            border: `1px solid ${tokens.ink[4]}`,
            background: tokens.neutral[0],
            color: tokens.ink[0],
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <>
      {error ? (
        <div role="status" style={{
          marginBottom: 10,
          padding: "9px 11px",
          border: `1px solid ${tokens.red.border}`,
          background: tokens.red.bg,
          color: tokens.red.text,
          fontSize: 10,
        }}>
          {error}
        </div>
      ) : null}
      <ReservationsAdminPanel
        config={state.config}
        weeklyServices={state.services}
        exceptions={state.exceptions}
        bookings={state.bookings}
        audit={audit}
        canEdit
        floorMaps={floorMaps}
        onSeedLab={seedLab}
        onSave={save}
      />
    </>
  );
}
