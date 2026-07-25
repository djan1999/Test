import React, { useCallback, useEffect, useState } from "react";
import { tokens } from "../styles/tokens.js";
import PublicBookingPage, { ManageBooking } from "../components/reservations/PublicBookingPage.jsx";
import StaffWorkspace from "./StaffWorkspace.jsx";
import {
  cancelManagedBooking,
  changeManagedBooking,
  getLabAccessCode,
  loadManagedBooking,
  loadPublicAvailability,
  loadPublicConfig,
  loadStaffState,
  setLabAccessCode,
  submitPublicBooking,
  submitPublicWaitlist,
  validatePublicBooking,
} from "./reservationClient.js";
import "./ReservationsLab.css";

const labTheme = {
  "--resv-bg": tokens.ink.bg,
  "--resv-card": tokens.neutral[0],
  "--resv-ink": tokens.ink[0],
  "--resv-body": tokens.ink[2],
  "--resv-muted": tokens.ink[3],
  "--resv-line": tokens.ink[4],
  "--resv-soft": tokens.ink[5],
  "--resv-green-bg": tokens.green.bg,
  "--resv-green": tokens.green.text,
  "--resv-green-line": tokens.green.border,
  "--resv-red-bg": tokens.red.bg,
  "--resv-red": tokens.red.text,
  "--resv-red-line": tokens.red.border,
  "--resv-gold": tokens.signal.active,
  "--resv-paper": tokens.tint.parchment,
  "--resv-font": tokens.font,
};

function LabGate({ onUnlock, error, busy }) {
  const [code, setCode] = useState("");
  return <main className="lab-gate" style={labTheme}>
    <div className="lab-ribbon">ISOLATED RESERVATIONS LAB · TEST DATA ONLY</div>
    <form onSubmit={(event) => { event.preventDefault(); onUnlock(code); }}>
      <span className="eyebrow">Milka Reservations</span>
      <h1>Open the LAB</h1>
      <p>This workspace uses the staging database and cannot change the restaurant’s live Service system.</p>
      <label><span>LAB access code</span><input type="password" autoFocus required value={code} onChange={(event) => setCode(event.target.value)} /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Opening…" : "Open reservations LAB"}</button>
      <a href="/book">Test the guest booking page instead →</a>
    </form>
  </main>;
}

function splitGuestList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function flattenPublicConfig(config) {
  return {
    ...(config || {}),
    ...(config?.online || {}),
    ...(config?.publicPage || {}),
  };
}

function PublicRoute() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const testMode = new URLSearchParams(window.location.search).get("test") === "1";

  useEffect(() => {
    loadPublicConfig()
      .then((result) => setConfig(flattenPublicConfig(result.config)))
      .catch((requestError) => setError(requestError.message));
  }, []);

  if (error) return <main className="lab-gate" style={labTheme}><div className="form-error">{error}</div></main>;
  if (!config) return <main className="lab-gate" style={labTheme}><div>Opening the booking diary…</div></main>;
  return <div style={labTheme}>
    <PublicBookingPage
      publicConfig={config}
      loadAvailability={async (date, pax) => (await loadPublicAvailability(date, pax)).services}
      submitBooking={(booking, idempotencyKey) => {
        const payload = {
          ...booking,
          allergies: splitGuestList(booking.allergies),
          accessibility: splitGuestList(booking.accessibility),
          source: "web",
        };
        return testMode
          ? validatePublicBooking(payload, idempotencyKey)
          : submitPublicBooking(payload, idempotencyKey);
      }}
      joinWaitlist={(entry) => {
        const payload = {
          ...entry,
          name: entry.name || entry.guestName,
          notes: entry.notes || entry.note || "",
        };
        // Test mode writes nothing at all, so the entry is checked against the same
        // required fields the server enforces and then dropped. A test run must never
        // leave a real row for the staff Waitlist tab to call back.
        if (testMode) {
          if (!payload.date || !payload.name || !Number(payload.pax)) {
            return Promise.reject(new Error("Date, name and party size are required."));
          }
          return Promise.resolve({ ok: true, test: true });
        }
        return submitPublicWaitlist(payload);
      }}
      testMode={testMode}
    />
  </div>;
}

function ManageRoute({ token }) {
  const [config, setConfig] = useState(null);
  const [booking, setBooking] = useState(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    Promise.all([
      loadPublicConfig(),
      loadManagedBooking(token),
    ]).then(([configResult, bookingResult]) => {
      setConfig(flattenPublicConfig(configResult.config));
      setBooking(bookingResult.booking);
    }).catch((requestError) => {
      if (requestError.code === "expired_link" || requestError.status === 404) setExpired(true);
      else setExpired(true);
    }).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <main className="lab-gate" style={labTheme}><div>Checking your manage link…</div></main>;
  if (changing && booking && config) {
    return <div style={labTheme}>
      <PublicBookingPage
        publicConfig={config}
        initialBooking={booking}
        startDate={booking.date}
        loadAvailability={async (date, pax) => (await loadPublicAvailability(date, pax, token)).services}
        submitBooking={(nextBooking, idempotencyKey) => changeManagedBooking(token, {
          ...nextBooking,
          allergies: splitGuestList(nextBooking.allergies),
          accessibility: splitGuestList(nextBooking.accessibility),
          source: "web",
        }, idempotencyKey)}
        joinWaitlist={null}
      />
    </div>;
  }
  return <div style={labTheme}>
    <ManageBooking
      booking={booking}
      expired={expired}
      restaurantName={config?.restaurantName || "Milka"}
      phone={config?.phone}
      onCancel={(reason) => cancelManagedBooking(token, reason)}
      onChange={() => setChanging(true)}
    />
  </div>;
}

function StaffLab() {

  const [payload, setPayload] = useState(null);
  const [accessCode, setAccessCodeState] = useState(getLabAccessCode);
  const [busy, setBusy] = useState(Boolean(accessCode));
  const [error, setError] = useState("");

  const refresh = useCallback(async (explicitCode = accessCode) => {
    setBusy(true);
    try {
      const result = await loadStaffState(explicitCode);
      setPayload(result);
      setError("");
      return result;
    } catch (requestError) {
      setPayload(null);
      setError(requestError.status === 401 ? "That LAB access code is not correct." : requestError.message);
      if (requestError.status === 401) setLabAccessCode("");
      throw requestError;
    } finally {
      setBusy(false);
    }
  }, [accessCode]);

  useEffect(() => {
    if (accessCode) refresh(accessCode).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function unlock(code) {
    setError("");
    try {
      await refresh(code);
      setLabAccessCode(code);
      setAccessCodeState(code);
    } catch {
      // Error copy is handled by refresh.
    }
  }

  function signOut() {
    setLabAccessCode("");
    setAccessCodeState("");
    setPayload(null);
  }

  if (!payload) return <LabGate onUnlock={unlock} error={error} busy={busy} />;
  return <div style={labTheme}>
    <StaffWorkspace state={payload.state} refresh={() => refresh(accessCode)} onSignOut={signOut} />
  </div>;
}

export default function ReservationsLabApp({ routePath }) {
  if (routePath === "/book") return <PublicRoute />;
  if (routePath.startsWith("/book/manage/")) {
    return <ManageRoute token={routePath.slice("/book/manage/".length)} />;
  }
  return <StaffLab />;
}
