// PublicBookingPage — the guest-facing half of the reservation system (/book).
//
// Presentation only: every decision comes from the server through the handlers
// passed in as props (Codex's reservationClient). This component never computes
// availability, never writes storage, and knows nothing of the legacy
// `reservations` shape — reservation_bookings is the canonical source behind the
// API it calls.
//
// Mobile-first: one question per screen, 44 px minimum targets, no horizontal
// scroll at 320 px. It reads as the restaurant's own page, not a booking widget.

import React, { useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;
const STEPS = ["when", "time", "experience", "you", "needs", "confirm"];

const page = {
  minHeight: "100vh", background: tokens.tint.parchment, color: tokens.ink[0],
  fontFamily: FONT, display: "flex", justifyContent: "center",
  padding: "18px 14px 56px", boxSizing: "border-box",
};
const sheet = { width: "100%", maxWidth: 440 };
const card = { background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "16px 16px 18px" };
const eyebrow = { fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: tokens.ink[3] };
const heading = { fontSize: 17, fontWeight: 500, lineHeight: 1.35, margin: "6px 0 4px", color: tokens.ink[0] };
const body = { fontSize: 11, lineHeight: 1.75, color: tokens.ink[2] };
const primary = {
  width: "100%", minHeight: 48, fontFamily: FONT, fontSize: 10, letterSpacing: 2.4,
  textTransform: "uppercase", fontWeight: 600, cursor: "pointer", borderRadius: 0,
  border: `1px solid ${tokens.charcoal.default}`, background: tokens.charcoal.default, color: tokens.neutral[0],
};
const secondary = { ...primary, background: tokens.neutral[0], color: tokens.ink[0] };
const option = (active, disabled) => ({
  minHeight: 46, fontFamily: FONT, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
  borderRadius: 0, padding: "10px 12px", textAlign: "left",
  border: `1px solid ${active ? tokens.green.border : tokens.ink[4]}`,
  background: active ? tokens.green.bg : tokens.neutral[0],
  color: disabled ? tokens.ink[4] : active ? tokens.green.text : tokens.ink[0],
  fontWeight: active ? 600 : 400,
});
const field = {
  width: "100%", boxSizing: "border-box", minHeight: 46, fontFamily: FONT,
  fontSize: tokens.mobileInputSize, padding: "11px 12px", borderRadius: 0,
  border: `1px solid ${tokens.ink[4]}`, outline: "none", background: tokens.neutral[0], color: tokens.ink[1],
};
const labelStyle = { ...eyebrow, display: "block", marginBottom: 6 };
const errorBox = {
  fontSize: 11, lineHeight: 1.7, color: tokens.red.text, background: tokens.red.bg,
  border: `1px solid ${tokens.red.border}`, padding: "9px 11px", marginBottom: 14,
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value) => String(value).padStart(2, "0");
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const shiftISO = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return isoOf(d); };
const readable = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/**
 * @param {object}   publicConfig   guest-safe configuration from the server
 * @param {Function} loadAvailability (date, pax) => Promise<{ services: [...] }>
 * @param {Function} submitBooking    (booking, idempotencyKey) => Promise<{ ref, manageUrl, status }>
 * @param {Function} joinWaitlist     (entry) => Promise
 * @param {boolean}  testMode         validates for real, creates nothing
 * @param {string}   startDate        optional ISO date to open on
 * @param {object}   initialBooking   server-validated booking when changing a manage link
 */
export default function PublicBookingPage({
  publicConfig,
  loadAvailability,
  submitBooking,
  joinWaitlist,
  testMode = false,
  startDate,
  initialBooking,
}) {
  const config = publicConfig || {};
  const restaurantName = config.restaurantName || "Restaurant";
  const maxPax = Number(config.maxPax || 6);
  const minPax = Number(config.minPax || 1);
  const windowDays = Number(config.windowDays || 60);
  const experiences = config.experiences || [];
  const policies = useMemo(() => (
    Array.isArray(config.policies) ? config.policies : String(config.policies || "").split("\n").filter(Boolean)
  ), [config.policies]);

  const today = isoOf(new Date());
  const [step, setStep] = useState("when");
  const [date, setDate] = useState(startDate || initialBooking?.date || today);
  const [pax, setPax] = useState(Number(initialBooking?.pax || 2));
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState(null);          // { time, service }
  const [experience, setExperience] = useState(initialBooking?.experience || experiences[0]?.key || "");
  const [guest, setGuest] = useState({
    name: initialBooking?.name || "",
    phone: initialBooking?.phone || "",
    email: initialBooking?.email || "",
    language: initialBooking?.language || (config.languages || ["en"])[0],
  });
  const [needs, setNeeds] = useState({
    allergies: Array.isArray(initialBooking?.allergies) ? initialBooking.allergies.join(", ") : initialBooking?.allergies || "",
    accessibility: Array.isArray(initialBooking?.accessibility) ? initialBooking.accessibility.join(", ") : initialBooking?.accessibility || "",
    occasion: initialBooking?.occasion || "",
    notes: initialBooking?.notes || "",
  });
  const [consent, setConsent] = useState(false);
  const [news, setNews] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [waitlistSent, setWaitlistSent] = useState(false);
  // One key per attempt at THIS booking: a double tap or a retry after a dropped
  // connection can never produce two reservations.
  const [submitKey] = useState(() => `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [submitting, setSubmitting] = useState(false);

  const dates = useMemo(
    () => Array.from({ length: Math.min(windowDays, 21) }, (_, index) => shiftISO(today, index)),
    [today, windowDays],
  );

  useEffect(() => {
    if (step !== "time" || !loadAvailability) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    loadAvailability(date, pax)
      .then((result) => { if (!cancelled) setAvailability(result?.services || result || []); })
      .catch(() => { if (!cancelled) setError("We could not read the diary just now. Please try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [step, date, pax, loadAvailability]);

  const openSlots = useMemo(() => (
    (availability || []).flatMap((service) => (service.slots || [])
      .map((slot) => ({ ...slot, service: service.service })))
  ), [availability]);
  const anyOpen = openSlots.some((slot) => slot.ok);
  const offered = experiences.filter((item) => !choice || !item.services || item.services.includes(choice.service));

  const go = (next) => { setError(""); setStep(next); };
  const back = () => {
    const index = STEPS.indexOf(step);
    if (index > 0) go(STEPS[index - 1]);
  };

  async function confirm() {
    if (!consent) { setError("Please accept the booking conditions so we can hold the table."); return; }
    if (!guest.name.trim()) { setError("We need a name for the table."); go("you"); return; }
    if (config.requirePhone !== false && !guest.phone.trim()) { setError("A telephone number lets us reach you on the day."); go("you"); return; }
    if (config.requireEmail !== false && !guest.email.trim()) { setError("An email address is where your confirmation goes."); go("you"); return; }
    setSubmitting(true);
    setError("");
    try {
      const result = await submitBooking({
        date,
        time: choice.time,
        service: choice.service,
        pax,
        experience,
        name: guest.name.trim(),
        phone: guest.phone.trim(),
        email: guest.email.trim(),
        language: guest.language,
        allergies: needs.allergies.trim(),
        accessibility: needs.accessibility.trim(),
        occasion: needs.occasion.trim(),
        notes: needs.notes.trim(),
        consentNews: news,
        source: "public",
      }, submitKey);
      setDone(result || {});
    } catch (submitError) {
      // The server is the authority: if the table went while the guest typed,
      // say so plainly and send them back to pick another time.
      if (submitError?.code === "slot_taken" || submitError?.code === "no_table") {
        setAvailability(null);
        setChoice(null);
        setError("That time was taken while you were filling this in. Here are the times still free.");
        go("time");
      } else if (submitError?.code === "party_too_large") {
        setError(`We take online bookings up to ${maxPax} guests. For a larger party, please call us.`);
      } else {
        setError(submitError?.message || "That did not go through. Nothing was booked — please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main style={page}>
        <div style={sheet}>
          <Masthead name={restaurantName} />
          <div style={card}>
            <span style={eyebrow}>{done.status === "pending" ? "Requested" : "Confirmed"}</span>
            <h1 style={heading}>
              {done.status === "pending"
                ? "We have your request"
                : `We look forward to seeing you, ${guest.name.split(" ")[0] || "and thank you"}`}
            </h1>
            <p style={body}>
              {pax} {pax === 1 ? "guest" : "guests"} · {readable(date)} · {choice?.time}
              {done.ref ? <><br />Reference <strong>{done.ref}</strong></> : null}
            </p>
            {done.status === "pending" ? (
              <p style={{ ...body, marginTop: 10 }}>
                A larger party is arranged personally — we will confirm by {config.requireEmail === false ? "telephone" : "email"} shortly.
              </p>
            ) : null}
            {testMode ? (
              <p style={{ ...body, border: `1px dashed ${tokens.signal.active}`, padding: "9px 11px", marginTop: 12 }}>
                Test booking — nothing was saved. This is exactly what a guest sees.
              </p>
            ) : null}
            {done.manageUrl ? (
              <a href={done.manageUrl} style={{ ...secondary, display: "block", textAlign: "center", lineHeight: "48px", textDecoration: "none", marginTop: 14 }}>
                Change or cancel this booking
              </a>
            ) : null}
            <p style={{ ...body, marginTop: 14, color: tokens.ink[3] }}>
              {config.phone ? `Anything else — ${config.phone}` : null}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <div style={sheet}>
        <Masthead name={restaurantName} tagline={step === "when" ? config.tagline : ""} />

        {testMode ? (
          <div style={{ ...body, background: tokens.neutral[0], border: `1px dashed ${tokens.signal.active}`, padding: "8px 11px", marginBottom: 12 }}>
            Test mode — availability is checked for real, but confirming will not create a booking.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {STEPS.map((key) => (
            <span key={key} style={{ flex: 1, height: 2, background: STEPS.indexOf(step) >= STEPS.indexOf(key) ? tokens.charcoal.default : tokens.ink[5] }} />
          ))}
        </div>

        <div style={card}>
          {error ? <div style={errorBox}>{error}</div> : null}

          {step === "when" ? (
            <>
              <span style={eyebrow}>Step one</span>
              <h1 style={heading}>How many of you, and when?</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 18px" }}>
                <button type="button" style={{ ...option(false), minWidth: 52, textAlign: "center" }} onClick={() => setPax(Math.max(minPax, pax - 1))}>−</button>
                <span style={{ fontSize: 20, fontWeight: 500, minWidth: 96, textAlign: "center" }}>
                  {pax} {pax === 1 ? "guest" : "guests"}
                </span>
                <button type="button" style={{ ...option(false), minWidth: 52, textAlign: "center" }} onClick={() => setPax(Math.min(maxPax, pax + 1))}>+</button>
              </div>
              {pax >= maxPax ? (
                <p style={{ ...body, marginBottom: 14 }}>
                  For more than {maxPax} guests, please call us{config.phone ? ` on ${config.phone}` : ""} — larger tables are arranged personally.
                </p>
              ) : null}
              <span style={labelStyle}>Which day?</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginBottom: 18 }}>
                {dates.map((value) => (
                  <button key={value} type="button" style={{ ...option(value === date), textAlign: "center", fontSize: 11 }} onClick={() => setDate(value)}>
                    {readable(value)}
                  </button>
                ))}
              </div>
              <button type="button" style={primary} onClick={() => go("time")}>See times</button>
            </>
          ) : null}

          {step === "time" ? (
            <>
              <span style={eyebrow}>{readable(date)} · {pax} {pax === 1 ? "guest" : "guests"}</span>
              <h1 style={heading}>What time suits you?</h1>
              {loading ? (
                <p style={{ ...body, marginTop: 12 }}>Looking at the diary…</p>
              ) : !anyOpen ? (
                <>
                  <p style={{ ...body, marginTop: 12 }}>
                    Nothing free for {pax} on {readable(date)}. Try another day — or leave your details and we will call if a table opens.
                  </p>
                  <button type="button" style={{ ...secondary, marginTop: 14 }} onClick={() => go("when")}>Choose another day</button>
                  {config.waitlistEnabled !== false && joinWaitlist ? (
                    waitlistSent ? (
                      <p style={{ ...body, marginTop: 12, color: tokens.green.text }}>We have your details — thank you.</p>
                    ) : (
                      <div style={{ marginTop: 16, borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 14 }}>
                        <span style={labelStyle}>Name</span>
                        <input style={field} value={guest.name} onChange={(event) => setGuest({ ...guest, name: event.target.value })} />
                        <span style={{ ...labelStyle, marginTop: 10 }}>Telephone</span>
                        <input style={field} inputMode="tel" value={guest.phone} onChange={(event) => setGuest({ ...guest, phone: event.target.value })} />
                        <button
                          type="button"
                          style={{ ...primary, marginTop: 14 }}
                          onClick={async () => {
                            if (!guest.name.trim() || !guest.phone.trim()) { setError("A name and telephone number, and we will call you."); return; }
                            try {
                              await joinWaitlist({ date, pax, guestName: guest.name.trim(), phone: guest.phone.trim(), note: needs.notes.trim() });
                              setWaitlistSent(true);
                            } catch { setError("That did not go through. Please try again."); }
                          }}
                        >
                          Let me know if a table opens
                        </button>
                      </div>
                    )
                  ) : null}
                </>
              ) : (
                <>
                  {(availability || []).map((service) => {
                    const slots = (service.slots || []).filter((slot) => slot.ok);
                    if (slots.length === 0) return null;
                    return (
                      <div key={service.service} style={{ marginTop: 14 }}>
                        <span style={labelStyle}>{service.service}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
                          {slots.map((slot) => (
                            <button
                              key={`${service.service}-${slot.time}`}
                              type="button"
                              style={{ ...option(choice?.time === slot.time && choice?.service === service.service), textAlign: "center" }}
                              onClick={() => { setChoice({ time: slot.time, service: service.service }); go(offered.length > 1 ? "experience" : "you"); }}
                            >
                              {slot.time}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" style={{ ...secondary, marginTop: 18 }} onClick={back}>Change day or party</button>
                </>
              )}
            </>
          ) : null}

          {step === "experience" ? (
            <>
              <span style={eyebrow}>{readable(date)} · {choice?.time} · {pax} {pax === 1 ? "guest" : "guests"}</span>
              <h1 style={heading}>How would you like to dine?</h1>
              <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
                {offered.map((item) => (
                  <button key={item.key} type="button" style={option(experience === item.key)} onClick={() => setExperience(item.key)}>
                    <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{item.title}</span>
                    <span style={{ ...body, display: "block", marginTop: 3 }}>{item.description}</span>
                  </button>
                ))}
              </div>
              <button type="button" style={{ ...primary, marginTop: 18 }} onClick={() => go("you")}>Continue</button>
              <button type="button" style={{ ...secondary, marginTop: 6 }} onClick={back}>Back</button>
            </>
          ) : null}

          {step === "you" ? (
            <>
              <span style={eyebrow}>Almost there</span>
              <h1 style={heading}>Who shall we expect?</h1>
              <div style={{ marginTop: 14 }}>
                <span style={labelStyle}>Name</span>
                <input style={field} value={guest.name} autoComplete="name" onChange={(event) => setGuest({ ...guest, name: event.target.value })} />
                <span style={{ ...labelStyle, marginTop: 12 }}>Telephone{config.requirePhone === false ? " (optional)" : ""}</span>
                <input style={field} inputMode="tel" autoComplete="tel" value={guest.phone} onChange={(event) => setGuest({ ...guest, phone: event.target.value })} />
                <span style={{ ...labelStyle, marginTop: 12 }}>Email{config.requireEmail === false ? " (optional)" : ""}</span>
                <input style={field} inputMode="email" autoComplete="email" value={guest.email} onChange={(event) => setGuest({ ...guest, email: event.target.value })} />
                {(config.languages || []).length > 1 ? (
                  <>
                    <span style={{ ...labelStyle, marginTop: 12 }}>Language</span>
                    <div style={{ display: "flex", gap: 5 }}>
                      {config.languages.map((code) => (
                        <button key={code} type="button" style={{ ...option(guest.language === code), flex: 1, textAlign: "center" }} onClick={() => setGuest({ ...guest, language: code })}>
                          {code === "sl" ? "Slovenščina" : "English"}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
              <button type="button" style={{ ...primary, marginTop: 18 }} onClick={() => go("needs")}>Continue</button>
              <button type="button" style={{ ...secondary, marginTop: 6 }} onClick={back}>Back</button>
            </>
          ) : null}

          {step === "needs" ? (
            <>
              <span style={eyebrow}>So the kitchen can prepare</span>
              <h1 style={heading}>Anything we should know?</h1>
              <div style={{ marginTop: 14 }}>
                <span style={labelStyle}>Allergies or dietary needs</span>
                <textarea
                  style={{ ...field, minHeight: 70, resize: "vertical", lineHeight: 1.6 }}
                  value={needs.allergies}
                  placeholder="Every course is prepared to order — tell us and we will adapt."
                  onChange={(event) => setNeeds({ ...needs, allergies: event.target.value })}
                />
                <span style={{ ...labelStyle, marginTop: 12 }}>Access needs</span>
                <input style={field} value={needs.accessibility} onChange={(event) => setNeeds({ ...needs, accessibility: event.target.value })} />
                <span style={{ ...labelStyle, marginTop: 12 }}>Occasion</span>
                <input style={field} value={needs.occasion} placeholder="Birthday, anniversary…" onChange={(event) => setNeeds({ ...needs, occasion: event.target.value })} />
                <span style={{ ...labelStyle, marginTop: 12 }}>Anything else</span>
                <textarea
                  style={{ ...field, minHeight: 60, resize: "vertical", lineHeight: 1.6 }}
                  value={needs.notes}
                  onChange={(event) => setNeeds({ ...needs, notes: event.target.value })}
                />
              </div>
              <button type="button" style={{ ...primary, marginTop: 18 }} onClick={() => go("confirm")}>Review</button>
              <button type="button" style={{ ...secondary, marginTop: 6 }} onClick={back}>Back</button>
            </>
          ) : null}

          {step === "confirm" ? (
            <>
              <span style={eyebrow}>One last look</span>
              <h1 style={heading}>{readable(date)} at {choice?.time}</h1>
              <p style={body}>
                {pax} {pax === 1 ? "guest" : "guests"}
                {experience ? ` · ${(experiences.find((item) => item.key === experience) || {}).title || ""}` : ""}
                <br />{guest.name}
                {guest.phone ? ` · ${guest.phone}` : ""}
                {guest.email ? <><br />{guest.email}</> : null}
                {needs.allergies ? <><br /><strong>Allergies:</strong> {needs.allergies}</> : null}
              </p>

              {policies.length ? (
                <div style={{ borderTop: `1px solid ${tokens.ink[5]}`, marginTop: 14, paddingTop: 12 }}>
                  <span style={eyebrow}>Booking conditions</span>
                  {policies.map((line, index) => (
                    <p key={index} style={{ ...body, marginTop: 6 }}>{line}</p>
                  ))}
                </div>
              ) : null}

              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, cursor: "pointer" }}>
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} style={{ width: 20, height: 20, marginTop: 1 }} />
                <span style={body}>I accept the booking conditions above.</span>
              </label>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={news} onChange={(event) => setNews(event.target.checked)} style={{ width: 20, height: 20, marginTop: 1 }} />
                <span style={body}>Write to me occasionally about the seasonal menus.</span>
              </label>

              <button type="button" style={{ ...primary, marginTop: 18, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={confirm}>
                {submitting ? "Sending…" : pax > (config.autoConfirmMaxPax ?? maxPax) ? "Request this table" : "Confirm this table"}
              </button>
              <button type="button" style={{ ...secondary, marginTop: 6 }} onClick={back}>Back</button>
            </>
          ) : null}
        </div>

        <p style={{ ...body, textAlign: "center", marginTop: 16, color: tokens.ink[3] }}>
          {config.phone ? `${restaurantName} · ${config.phone}` : restaurantName}
        </p>
      </div>
    </main>
  );
}

function Masthead({ name, tagline }) {
  return (
    <header style={{ textAlign: "center", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase" }}>{name}</div>
      {tagline ? <p style={{ ...body, marginTop: 8 }}>{tagline}</p> : null}
    </header>
  );
}

/**
 * ManageBooking — what a guest sees after following the manage link. The token
 * is validated server-side; this only renders the outcome.
 *
 * @param {object}   booking   { ref, date, time, pax, status, name } or null
 * @param {boolean}  expired   true when the link is spent, revoked or wrong
 * @param {Function} onCancel  (reason) => Promise
 * @param {Function} onChange  () => void — hand back to the booking flow
 */
export function ManageBooking({ booking, expired, onCancel, onChange, restaurantName = "Restaurant", phone }) {
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main style={page}>
      <div style={sheet}>
        <Masthead name={restaurantName} />
        <div style={card}>
          {expired || !booking ? (
            <>
              <span style={eyebrow}>Link expired</span>
              <h1 style={heading}>This link no longer works</h1>
              <p style={body}>
                Manage links expire after the visit, and a cancelled booking releases its link straight away.
                {phone ? ` Call us on ${phone} and we will sort it out.` : ""}
              </p>
            </>
          ) : cancelled ? (
            <>
              <span style={eyebrow}>Cancelled</span>
              <h1 style={heading}>Your table has been released</h1>
              <p style={body}>Thank you for telling us — we hope to welcome you another time.</p>
            </>
          ) : (
            <>
              <span style={eyebrow}>Your booking · {booking.ref}</span>
              <h1 style={heading}>{readable(booking.date)} at {booking.time}</h1>
              <p style={body}>{booking.pax} {booking.pax === 1 ? "guest" : "guests"} · {booking.name}</p>
              {error ? <div style={{ ...errorBox, marginTop: 12, marginBottom: 0 }}>{error}</div> : null}
              <button type="button" style={{ ...primary, marginTop: 18 }} onClick={onChange}>Change day or time</button>
              <button
                type="button"
                style={{ ...secondary, marginTop: 6, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={async () => {
                  const reason = window.prompt("Cancelling — may we ask why?", "Plans changed");
                  if (reason === null) return;
                  setBusy(true);
                  try { await onCancel(reason.trim() || "Cancelled by guest"); setCancelled(true); }
                  catch { setError("That did not go through. Your booking still stands — please try again."); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? "Cancelling…" : "Cancel this booking"}
              </button>
            </>
          )}
        </div>
        <p style={{ ...body, textAlign: "center", marginTop: 16, color: tokens.ink[3] }}>
          {phone ? `${restaurantName} · ${phone}` : restaurantName}
        </p>
      </div>
    </main>
  );
}
