import React, { useCallback, useEffect, useState } from "react";
import { tokens } from "../styles/tokens.js";
import BookingPage, { ManageBookingPage } from "./BookingPage.jsx";
import StaffWorkspace from "./StaffWorkspace.jsx";
import { getLabAccessCode, loadStaffState, setLabAccessCode } from "./reservationClient.js";
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

export default function ReservationsLabApp({ routePath }) {
  if (routePath === "/book") return <div style={labTheme}><BookingPage /></div>;
  if (routePath.startsWith("/book/manage/")) {
    const token = routePath.slice("/book/manage/".length);
    return <div style={labTheme}><ManageBookingPage token={token} /></div>;
  }

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
