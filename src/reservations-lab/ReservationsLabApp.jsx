import React, { useEffect, useState } from "react";
import { tokens } from "../styles/tokens.js";
import PublicBookingPage, { ManageBooking } from "../components/reservations/PublicBookingPage.jsx";
import ReservationWorkspace from "../components/reservations/ReservationWorkspace.jsx";
import { useReservationWorkspace } from "../components/reservations/useReservationWorkspace.js";
import {
  cancelManagedBooking,
  changeManagedBooking,
  getLabAccessCode,
  loadManagedBooking,
  loadPublicAvailability,
  loadPublicConfig,
  setLabAccessCode,
  submitPublicBooking,
  submitPublicWaitlist,
  validatePublicBooking,
} from "./reservationClient.js";

const page = {
  minHeight: "100vh",
  background: tokens.ink.bg,
  fontFamily: tokens.font,
  color: tokens.ink[1],
};

const eyebrow = {
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: tokens.ink[3],
};

const quietButton = {
  fontFamily: tokens.font,
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "6px 12px",
  background: "transparent",
  color: tokens.ink[2],
  border: `${tokens.rule.hairline} solid ${tokens.ink[4]}`,
  borderRadius: tokens.radius,
  cursor: "pointer",
};

/** The ribbon is the one piece of chrome that must never be missed: it is the
 *  difference between a host trying something out and a host editing the book
 *  the floor is about to work from. */
const ribbon = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 16px",
  background: tokens.tint.parchment,
  borderBottom: `${tokens.rule.hairline} solid ${tokens.ink[4]}`,
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: tokens.ink[2],
};

function LabNotice({ children, tone = "body" }) {
  return <main style={{ ...page, display: "grid", placeItems: "center", padding: 24 }}>
    <p style={{
      fontSize: 11,
      letterSpacing: "0.08em",
      color: tone === "error" ? tokens.red.text : tokens.ink[2],
    }}>{children}</p>
  </main>;
}

function LabGate({ onUnlock, error, busy }) {
  const [code, setCode] = useState("");
  return <main style={{ ...page, display: "grid", placeItems: "center", padding: 24 }}>
    <form
      onSubmit={(event) => { event.preventDefault(); onUnlock(code); }}
      style={{
        width: "100%",
        maxWidth: 420,
        background: tokens.neutral[0],
        border: `${tokens.rule.hairline} solid ${tokens.ink[4]}`,
        borderRadius: tokens.radius,
        padding: 32,
      }}
    >
      <div style={{ ...ribbon, margin: "-32px -32px 24px", borderBottom: `${tokens.rule.hairline} solid ${tokens.ink[4]}` }}>
        Isolated reservations LAB · test data only
      </div>
      <span style={eyebrow}>Milka Reservations</span>
      <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: "0.02em", margin: "8px 0 12px", color: tokens.ink[0] }}>
        Open the LAB
      </h1>
      <p style={{ fontSize: 12, lineHeight: 1.6, color: tokens.ink[2], marginBottom: 20 }}>
        This workspace uses the staging database and cannot change the restaurant’s live Service system.
      </p>
      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ ...eyebrow, display: "block", marginBottom: 6 }}>LAB access code</span>
        <input
          type="password"
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          style={{
            width: "100%",
            fontFamily: tokens.font,
            fontSize: tokens.mobileInputSize,
            padding: "10px 12px",
            background: tokens.ink.bg,
            color: tokens.ink[0],
            border: `${tokens.rule.hairline} solid ${tokens.ink[4]}`,
            borderRadius: tokens.radius,
          }}
        />
      </label>
      {error && (
        <p style={{ fontSize: 11, lineHeight: 1.5, color: tokens.red.text, marginBottom: 16 }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          width: "100%",
          fontFamily: tokens.font,
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "12px 16px",
          background: tokens.ink[0],
          color: tokens.neutral[0],
          border: "none",
          borderRadius: tokens.radius,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Opening…" : "Open reservations LAB"}
      </button>
      <a
        href="/book"
        style={{ display: "inline-block", marginTop: 16, fontSize: 11, color: tokens.ink[2] }}
      >
        Test the guest booking page instead →
      </a>
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

  if (error) return <LabNotice tone="error">{error}</LabNotice>;
  if (!config) return <LabNotice>Opening the booking diary…</LabNotice>;
  return <div style={page}>
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
    }).catch(() => {
      setExpired(true);
    }).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LabNotice>Checking your manage link…</LabNotice>;
  if (changing && booking && config) {
    return <div style={page}>
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
  return <div style={page}>
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
  const [accessCode, setAccessCode] = useState(getLabAccessCode);
  // The same hook the in-app reservations mode uses, so the standalone route and
  // the mode cannot drift into two different workspaces.
  const workspace = useReservationWorkspace({
    enabled: Boolean(accessCode),
    accessCode,
  });

  // A refused code must not survive in session storage, or every reload spends a
  // request proving again that it is wrong.
  useEffect(() => {
    if (accessCode && workspace.errorStatus === 401) {
      setLabAccessCode("");
      setAccessCode("");
    }
  }, [accessCode, workspace.errorStatus]);

  if (!accessCode) {
    return <LabGate
      onUnlock={(code) => { setLabAccessCode(code); setAccessCode(code); }}
      error={workspace.errorStatus === 401 ? "That LAB access code is not correct." : workspace.error}
      busy={workspace.loading}
    />;
  }

  function signOut() {
    setLabAccessCode("");
    setAccessCode("");
  }

  return <div style={page}>
    <div style={ribbon}>
      <span>Isolated reservations LAB · test data only</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        style={quietButton}
        onClick={() => workspace.retry().catch(() => {})}
        disabled={workspace.loading}
      >
        {workspace.loading ? "Refreshing…" : "Refresh"}
      </button>
      <button type="button" style={quietButton} onClick={signOut}>Sign out</button>
    </div>
    <ReservationWorkspace
      bookings={workspace.bookings}
      reservationConfig={workspace.reservationConfig}
      weeklyServices={workspace.weeklyServices}
      calendarRules={workspace.calendarRules}
      waitlist={workspace.waitlist}
      onSaveBooking={workspace.onSaveBooking}
      onDeleteBooking={workspace.onDeleteBooking}
      onStatusChange={workspace.onStatusChange}
      onAssignTables={workspace.onAssignTables}
      onSwapBookings={workspace.onSwapBookings}
      onResolveConflict={workspace.onResolveConflict}
      onConvertWaitlist={workspace.onConvertWaitlist}
      onRemoveWaitlist={workspace.onRemoveWaitlist}
      onPrintKitchenTicket={workspace.onPrintKitchenTicket}
      onPrintBreakdown={workspace.onPrintBreakdown}
      onPrintAllergySheet={workspace.onPrintAllergySheet}
      onPrintWeekly={workspace.onPrintWeekly}
      loading={workspace.loading}
      error={workspace.error}
      onRetry={workspace.retry}
    />
  </div>;
}

export default function ReservationsLabApp({ routePath }) {
  if (routePath === "/book") return <PublicRoute />;
  if (routePath.startsWith("/book/manage/")) {
    return <ManageRoute token={routePath.slice("/book/manage/".length)} />;
  }
  return <StaffLab />;
}
