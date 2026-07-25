// PublicBookingPage — the guest half of the reservation system, for /book.
//
// Mobile-first, one question per screen: party and day → a time that is
// genuinely available → experience → who you are → allergies and access →
// review with the conditions and consent → confirmation with a reference and a
// private manage link.
//
// Presentation only. It computes no availability of its own: every time shown
// comes back from the server, and the submit re-validates against the freshest
// state. No table inventory, pacing number, other guest or staff field ever
// reaches this page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { UNAVAILABLE_REASONS } from "../../domain/reservations/availability.js";
// The same bounds the server holds this form to. Applied here so a guest is
// stopped as they type rather than losing what they wrote on submit.
import { LIMITS } from "../../domain/reservations/validation.js";

const FONT = tokens.font;

// A closed time says which kind of "no" it is. None of these names another
// guest or reveals a table count — but "no table of the right size" and "that
// seating is full" send a guest to two different next moves, and a bare "Full"
// sends them away.
const SLOT_BADGES = {
  not_offered: "Not served",
  party_too_small: "Min party",
  party_too_large: "Call us",
  too_late: "Too late",
  day_full: "Full",
  service_full: "Full",
  sitting_full: "Full",
  no_table: "No table",
};

const ACCESS_OPTIONS = ["Step-free access", "Wheelchair space at the table", "Assistance dog", "High chair"];
const OCCASIONS = ["Birthday", "Anniversary", "Celebration"];
const WINDOWS = ["Lunch", "Early dinner", "Late dinner", "Any time"];
const STEPS = ["date", "time", "details", "prefs", "review"];
const STEP_LABELS = ["Date", "Time", "Details", "Preferences", "Review"];

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
};

const page = { minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, color: tokens.ink[1], display: "flex", flexDirection: "column", alignItems: "center" };
const column = { width: "100%", maxWidth: 480, padding: "30px 20px 70px", boxSizing: "border-box" };
const eyebrow = { fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3] };
const bigInput = { fontSize: 16, border: `1px solid ${tokens.ink[4]}`, padding: 12, outline: "none", width: "100%", boxSizing: "border-box", background: tokens.neutral[0], color: tokens.ink[1], fontFamily: FONT, borderRadius: 0 };
const primary = { width: "100%", minHeight: 48, marginTop: 24, border: `1px solid ${tokens.charcoal.default}`, background: tokens.charcoal.default, color: tokens.neutral[0], fontSize: 10, letterSpacing: "0.16em", fontWeight: 600, textTransform: "uppercase", cursor: "pointer", fontFamily: FONT, borderRadius: 0 };
const secondary = { ...primary, background: tokens.neutral[0], color: tokens.ink[1], border: `1px solid ${tokens.ink[3]}` };
const errorText = { fontSize: 9, color: tokens.red.text, marginTop: 4, minHeight: 12 };

function chip(on, opts = {}) {
  return {
    fontSize: opts.fs || 10,
    letterSpacing: "0.06em",
    padding: opts.pad || "11px 13px",
    minHeight: 44,
    border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
    background: on ? tokens.tint.parchment : tokens.neutral[0],
    color: on ? tokens.ink[0] : tokens.ink[2],
    fontWeight: on ? 600 : 400,
    cursor: "pointer",
    fontFamily: FONT,
    boxSizing: "border-box",
    borderRadius: 0,
  };
}

/** Policies arrive as a string or a list; render either as separate lines. */
const policyLines = (policies) => {
  if (Array.isArray(policies)) return policies.filter(Boolean);
  return String(policies || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

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
  const maxPax = Number(config.maxPax || 6);
  const minPax = Number(config.minPax || 1);
  const windowDays = Number(config.windowDays || 60);
  const languages = config.languages?.length ? config.languages : ["en", "sl"];
  const experiences = useMemo(() => config.experiences || [], [config.experiences]);

  const [step, setStep] = useState("date");
  const [guest, setGuest] = useState(() => ({
    date: initialBooking?.date || startDate || isoOf(new Date()),
    pax: Number(initialBooking?.pax || 2),
    time: "",
    service: "",
    experience: initialBooking?.experience || "",
    name: initialBooking?.name || "",
    email: initialBooking?.email || "",
    phone: initialBooking?.phone || "",
    language: initialBooking?.language || languages[0] || "en",
    allergies: initialBooking?.allergies || [],
    accessibility: initialBooking?.accessibility || [],
    occasion: initialBooking?.occasion || "",
    notes: initialBooking?.notes || "",
    consent: false,
    news: false,
  }));
  const [errors, setErrors] = useState({});
  const [services, setServices] = useState(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [takenNotice, setTakenNotice] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [waitlist, setWaitlist] = useState({ name: "", phone: "", email: "", window: "" });
  const [waitlistErrors, setWaitlistErrors] = useState({});
  const [waitlistDone, setWaitlistDone] = useState(null);

  const patch = (next) => setGuest((current) => ({ ...current, ...next }));

  const dates = useMemo(() => {
    const base = new Date(`${startDate || isoOf(new Date())}T12:00:00`);
    return Array.from({ length: Math.min(14, Math.max(1, windowDays)) }, (_, index) => {
      const d = new Date(base);
      d.setDate(base.getDate() + index);
      return { iso: isoOf(d), dow: DOW[d.getDay()], dd: String(d.getDate()) };
    });
  }, [startDate, windowDays]);

  const fetchTimes = useCallback(
    async (date, pax) => {
      setLoadingTimes(true);
      setAvailabilityError("");
      try {
        const result = await loadAvailability(date, pax);
        setServices(Array.isArray(result) ? result : []);
      } catch (loadError) {
        setServices([]);
        setAvailabilityError(loadError?.message || "We could not check availability just now.");
      } finally {
        setLoadingTimes(false);
      }
    },
    [loadAvailability],
  );

  const goToTimes = () => {
    setStep("time");
    setTakenNotice("");
    fetchTimes(guest.date, guest.pax);
  };

  const anyOpen = (services || []).some((service) => service.slots?.some((slot) => slot.ok));

  const confirm = async () => {
    if (!guest.consent) {
      setErrors({ consent: "Please accept the reservation conditions to continue." });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    const key = idempotencyKey || `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setIdempotencyKey(key);
    try {
      const result = await submitBooking(
        {
          date: guest.date,
          service: guest.service,
          time: guest.time,
          pax: guest.pax,
          name: guest.name.trim(),
          email: guest.email.trim(),
          phone: guest.phone.trim(),
          language: guest.language,
          experience: guest.experience,
          allergies: guest.allergies,
          accessibility: guest.accessibility,
          occasion: guest.occasion,
          notes: guest.notes.trim(),
          consentNews: guest.news,
        },
        key,
      );
      setDone(result || {});
      setStep("done");
    } catch (submitError) {
      const code = submitError?.code;
      if (code === "slot_taken" || code === "no_table") {
        // The table went while the guest was deciding. Nothing was booked —
        // say so plainly and show what is actually free now.
        setTakenNotice(
          code === "no_table"
            ? "The last table at that time went while you were choosing. Nothing was booked — these times are current."
            : "That time was taken just before we could confirm it. Nothing was booked — these times are current.",
        );
        setStep("time");
        patch({ time: "", service: "" });
        setIdempotencyKey(null);
        fetchTimes(guest.date, guest.pax);
      } else if (code === "party_too_large") {
        setStep("waitlist");
        setWaitlist((current) => ({ ...current, name: guest.name, phone: guest.phone, email: guest.email }));
      } else {
        setErrors({ submit: submitError?.message || "We could not complete that booking." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const offeredExperiences = experiences.filter(
    (item) => !guest.service || !item.services || item.services.includes(guest.service),
  );

  return (
    <div style={page}>
      <div style={column}>
        <header style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.34em", color: tokens.ink[0] }}>
            {(config.restaurantName || "MILKA").toUpperCase()}
          </div>
          {config.tagline && <div style={{ fontSize: 8, letterSpacing: "0.22em", color: tokens.ink[3], marginTop: 6 }}>{config.tagline}</div>}
          <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, marginTop: 16 }} />
        </header>

        {testMode && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", border: `1px dashed ${tokens.signal.active}`, background: tokens.neutral[0], padding: "8px 12px", marginBottom: 18 }}>
            <span style={{ width: 6, height: 6, background: tokens.signal.active, flexShrink: 0 }} />
            <span style={{ fontSize: 9, letterSpacing: "0.10em", color: tokens.ink[2], lineHeight: 1.6 }}>
              Test mode — availability is checked for real, but confirming will not create a reservation.
            </span>
          </div>
        )}

        {stepIndex >= 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {STEPS.map((_, index) => (
                <span
                  key={index}
                  style={{
                    width: 8,
                    height: 8,
                    display: "inline-block",
                    background: index <= stepIndex ? tokens.charcoal.default : tokens.neutral[0],
                    border: `1px solid ${index <= stepIndex ? tokens.charcoal.default : tokens.ink[4]}`,
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: 8, letterSpacing: "0.16em", color: tokens.ink[3], textTransform: "uppercase" }}>
              Step {pad(stepIndex + 1)} / {pad(STEPS.length)} — {STEP_LABELS[stepIndex]}
            </span>
          </div>
        )}

        {step === "date" && (
          <section>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: tokens.ink[0], lineHeight: 1.4, margin: 0 }}>Reserve a table</h1>
            <div style={{ ...eyebrow, margin: "22px 0 8px" }}>Date</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
              {dates.map((item) => (
                <button
                  key={item.iso}
                  type="button"
                  onClick={() => patch({ date: item.iso, time: "", service: "" })}
                  style={{
                    padding: "8px 0",
                    textAlign: "center",
                    minHeight: 46,
                    border: `1px solid ${guest.date === item.iso ? tokens.charcoal.default : tokens.ink[4]}`,
                    background: guest.date === item.iso ? tokens.tint.parchment : tokens.neutral[0],
                    color: tokens.ink[1],
                    cursor: "pointer",
                    fontFamily: FONT,
                    boxSizing: "border-box",
                    borderRadius: 0,
                  }}
                >
                  <span style={{ fontSize: 7, letterSpacing: "0.10em", display: "block", color: tokens.ink[3] }}>{item.dow}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, display: "block", marginTop: 2 }}>{item.dd}</span>
                </button>
              ))}
            </div>

            <div style={{ ...eyebrow, margin: "22px 0 8px" }}>Guests</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
              <button type="button" onClick={() => patch({ pax: Math.max(minPax, guest.pax - 1) })} style={{ ...chip(false), width: 48, height: 48, fontSize: 18 }}>
                −
              </button>
              <span style={{ fontSize: 22, fontWeight: 600, minWidth: 34, textAlign: "center", color: tokens.ink[0] }}>{guest.pax}</span>
              <button type="button" onClick={() => patch({ pax: guest.pax + 1 })} style={{ ...chip(false), width: 48, height: 48, fontSize: 18 }}>
                +
              </button>
            </div>
            <div style={{ fontSize: 9, color: tokens.ink[3], textAlign: "center", marginTop: 10, lineHeight: 1.7 }}>
              {guest.pax > maxPax
                ? `For parties of more than ${maxPax} we arrange the evening personally${config.phone ? ` — call us on ${config.phone}` : ""}.`
                : `${fmtDate(guest.date)} · ${guest.pax} ${guest.pax === 1 ? "guest" : "guests"}`}
            </div>

            <button
              type="button"
              style={primary}
              onClick={() => {
                if (guest.pax > maxPax) {
                  if (joinWaitlist) {
                    setStep("waitlist");
                    setWaitlist((current) => ({ ...current, name: guest.name, phone: guest.phone, email: guest.email }));
                  }
                  return;
                }
                goToTimes();
              }}
            >
              {guest.pax > maxPax ? (joinWaitlist ? "Continue to waitlist" : "Please call us") : "Find a time"}
            </button>
          </section>
        )}

        {step === "time" && (
          <section>
            <BackLink onClick={() => setStep("date")} />
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.ink[0] }}>
              {fmtDate(guest.date)} · {guest.pax} {guest.pax === 1 ? "guest" : "guests"}
            </div>

            {takenNotice && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0], padding: "10px 12px", marginTop: 14 }}>
                <span style={{ width: 6, height: 6, background: tokens.signal.warn, flexShrink: 0, marginTop: 3 }} />
                <span style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.6 }}>{takenNotice}</span>
              </div>
            )}

            {availabilityError && (
              <div style={{ border: `1px solid ${tokens.red.border}`, background: tokens.red.bg, padding: "10px 12px", marginTop: 14, fontSize: 10, color: tokens.red.text, lineHeight: 1.6 }}>
                {availabilityError}
              </div>
            )}

            {loadingTimes && (
              <div style={{ textAlign: "center", padding: "44px 0", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[3] }}>
                Checking availability…
              </div>
            )}

            {!loadingTimes && services && anyOpen && (
              <>
                {services.map((service) => {
                  const slots = service.slots || [];
                  if (!slots.length) return null;
                  return (
                    <div key={service.service}>
                      <div style={{ ...eyebrow, margin: "20px 0 8px" }}>{service.service}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
                        {slots.map((slot) => (
                          <button
                            key={slot.time}
                            type="button"
                            disabled={!slot.ok}
                            title={slot.ok ? "" : (UNAVAILABLE_REASONS[slot.reason] || "")}
                            onClick={() =>
                              patch({
                                time: slot.time,
                                service: service.service,
                                experience: guest.experience || offeredExperiences[0]?.key || "",
                              })
                            }
                            style={{
                              ...chip(guest.time === slot.time && guest.service === service.service, { pad: "9px 4px" }),
                              textAlign: "center",
                              opacity: slot.ok ? 1 : 0.55,
                              cursor: slot.ok ? "pointer" : "not-allowed",
                              borderColor: guest.time === slot.time ? tokens.charcoal.default : slot.ok ? tokens.ink[4] : tokens.ink[5],
                              color: slot.ok ? tokens.ink[1] : tokens.neutral[400],
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, display: "block" }}>{slot.time}</span>
                            <span style={{ fontSize: 7, letterSpacing: "0.12em", color: tokens.ink[4], display: "block", marginTop: 2, minHeight: 9, textTransform: "uppercase" }}>
                              {slot.ok ? "" : (SLOT_BADGES[slot.reason] || "Full")}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {joinWaitlist && (
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("waitlist");
                        setWaitlist((current) => ({ ...current, name: guest.name, phone: guest.phone, email: guest.email }));
                      }}
                      style={{ border: "none", background: "none", color: tokens.green.text, fontSize: 9, letterSpacing: "0.08em", padding: 0, cursor: "pointer", fontFamily: FONT, textDecoration: "underline" }}
                    >
                      Preferred time not available? Join the waitlist →
                    </button>
                  </div>
                )}

                {guest.time && offeredExperiences.length > 0 && (
                  <>
                    <div style={{ ...eyebrow, margin: "22px 0 8px" }}>Dining experience</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {offeredExperiences.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => patch({ experience: item.key })}
                          style={{ ...chip(guest.experience === item.key), textAlign: "left", padding: "12px 14px", width: "100%" }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", display: "block", textTransform: "uppercase" }}>{item.title}</span>
                          {item.description && (
                            <span style={{ fontSize: 9, color: tokens.ink[3], display: "block", marginTop: 4, lineHeight: 1.6 }}>{item.description}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <button type="button" style={primary} disabled={!guest.time} onClick={() => guest.time && setStep("details")}>
                  Continue
                </button>
              </>
            )}

            {!loadingTimes && services && !anyOpen && (
              <div style={{ border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], padding: 18, marginTop: 20, textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: tokens.ink[0], lineHeight: 1.7 }}>No tables are available online for this date.</div>
                <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.8, marginTop: 6 }}>
                  {config.whenFull === "phone" || !joinWaitlist
                    ? `Choose another date${config.phone ? `, or call us on ${config.phone}` : ""}.`
                    : "Choose another date, or leave your details and we will call if a table opens."}
                </div>
                {joinWaitlist && config.whenFull !== "phone" && (
                  <button
                    type="button"
                    style={primary}
                    onClick={() => {
                      setStep("waitlist");
                      setWaitlist((current) => ({ ...current, name: guest.name, phone: guest.phone, email: guest.email }));
                    }}
                  >
                    Join the waitlist
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {step === "details" && (
          <section>
            <BackLink onClick={() => setStep("time")} />
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.ink[0], marginBottom: 18 }}>Your details</div>

            <div style={{ ...eyebrow, marginBottom: 6 }}>Full name</div>
            <input value={guest.name} onChange={(event) => patch({ name: event.target.value })} placeholder="Name and surname" maxLength={LIMITS.name} style={bigInput} />
            <div style={errorText}>{errors.name || ""}</div>

            <div style={{ ...eyebrow, margin: "10px 0 6px" }}>Email{config.requireEmail === false ? " (optional)" : ""}</div>
            <input value={guest.email} onChange={(event) => patch({ email: event.target.value })} placeholder="you@example.com" type="email" inputMode="email" maxLength={LIMITS.email} style={bigInput} />
            <div style={errorText}>{errors.email || ""}</div>

            <div style={{ ...eyebrow, margin: "10px 0 6px" }}>Telephone{config.requirePhone === false ? " (optional)" : ""}</div>
            <input value={guest.phone} onChange={(event) => patch({ phone: event.target.value })} placeholder="+386 …" type="tel" inputMode="tel" maxLength={LIMITS.phone} style={bigInput} />
            <div style={errorText}>{errors.phone || ""}</div>

            {languages.length > 1 && (
              <>
                <div style={{ ...eyebrow, margin: "10px 0 6px" }}>Preferred language</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {languages.map((code) => (
                    <button key={code} type="button" style={chip(guest.language === code, { fs: 9 })} onClick={() => patch({ language: code })}>
                      {code === "sl" ? "Slovenščina" : "English"}
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              style={primary}
              onClick={() => {
                const next = {};
                if (guest.name.trim().length < 2) next.name = "Please enter your name.";
                if (config.requireEmail !== false && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email.trim())) {
                  next.email = "Please enter a valid email — your confirmation goes here.";
                }
                if (config.requirePhone !== false && guest.phone.replace(/\D/g, "").length < 8) {
                  next.phone = "Please enter a telephone number we can reach.";
                }
                if (Object.keys(next).length) {
                  setErrors(next);
                  return;
                }
                setErrors({});
                setStep("prefs");
              }}
            >
              Continue
            </button>
          </section>
        )}

        {step === "prefs" && (
          <section>
            <BackLink onClick={() => setStep("details")} />
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.ink[0] }}>Allergies and preferences</div>
            <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.8, marginTop: 6 }}>
              The kitchen adapts each course. Please tell us about allergies before your visit.
            </div>

            <div style={{ ...eyebrow, margin: "18px 0 8px" }}>Allergies and dietary needs</div>
            <textarea
              value={(guest.allergies || []).join(", ")}
              onChange={(event) => patch({
                allergies: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .slice(0, LIMITS.allergies),
              })}
              maxLength={LIMITS.allergyNote}
              placeholder="Gluten, nuts, vegetarian…"
              style={{ ...bigInput, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
            />

            <div style={{ ...eyebrow, margin: "18px 0 8px" }}>Accessibility</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {ACCESS_OPTIONS.map((option) => {
                const on = (guest.accessibility || []).includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    style={chip(on, { fs: 9, pad: "10px 11px" })}
                    onClick={() =>
                      patch({ accessibility: on ? guest.accessibility.filter((item) => item !== option) : [...(guest.accessibility || []), option] })
                    }
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            <div style={{ ...eyebrow, margin: "18px 0 8px" }}>Occasion (optional)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {OCCASIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  style={chip(guest.occasion === option, { fs: 9, pad: "10px 11px" })}
                  onClick={() => patch({ occasion: guest.occasion === option ? "" : option })}
                >
                  {option}
                </button>
              ))}
            </div>

            <div style={{ ...eyebrow, margin: "18px 0 8px" }}>Anything else</div>
            <textarea
              value={guest.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              placeholder="Timings, a surprise, several guests sharing an allergy…"
              maxLength={LIMITS.notes}
              style={{ ...bigInput, minHeight: 72, resize: "vertical", lineHeight: 1.5 }}
            />

            <button type="button" style={primary} onClick={() => setStep("review")}>
              Review reservation
            </button>
          </section>
        )}

        {step === "review" && (
          <section>
            <BackLink onClick={() => setStep("prefs")} />
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.ink[0], marginBottom: 14 }}>Review and confirm</div>

            <SummaryRows
              rows={[
                { k: "Date", v: `${fmtDate(guest.date)} ${guest.date.slice(0, 4)}` },
                { k: "Time", v: `${guest.time} · ${(guest.service || "").toUpperCase()}` },
                { k: "Guests", v: String(guest.pax) },
                { k: "Experience", v: experiences.find((item) => item.key === guest.experience)?.title || "—" },
                { k: "Name", v: guest.name.trim() },
                ...(guest.phone.trim() ? [{ k: "Telephone", v: guest.phone.trim() }] : []),
                ...(guest.email.trim() ? [{ k: "Email", v: guest.email.trim() }] : []),
                ...(guest.allergies?.length ? [{ k: "Allergies", v: guest.allergies.join(", ") }] : []),
                ...(guest.accessibility?.length ? [{ k: "Accessibility", v: guest.accessibility.join(", ") }] : []),
                ...(guest.occasion ? [{ k: "Occasion", v: guest.occasion }] : []),
              ]}
            />

            {policyLines(config.policies).length > 0 && (
              <div style={{ border: `1px solid ${tokens.ink[5]}`, background: tokens.neutral[0], padding: 12, marginTop: 12, fontSize: 9, color: tokens.ink[2], lineHeight: 1.9 }}>
                <span style={{ ...eyebrow, display: "block", marginBottom: 6 }}>Reservation conditions</span>
                {policyLines(config.policies).map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            )}

            <Checkbox
              checked={guest.consent}
              onToggle={() => patch({ consent: !guest.consent })}
              label={
                <>
                  I accept the reservation conditions and consent to my details being used to manage this reservation.{" "}
                  <span style={{ color: tokens.red.text }}>(required)</span>
                </>
              }
            />
            <Checkbox muted checked={guest.news} onToggle={() => patch({ news: !guest.news })} label="Send me occasional news from the restaurant. (optional)" />

            <div style={{ ...errorText, marginTop: 8 }}>{errors.consent || errors.submit || ""}</div>

            <button type="button" style={{ ...primary, minHeight: 52, marginTop: 12 }} disabled={submitting} onClick={confirm}>
              {submitting ? "Confirming…" : "Confirm reservation"}
            </button>
          </section>
        )}

        {step === "done" && done && (
          <section style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600, color: done.status === "pending" ? tokens.signal.warn : tokens.green.text }}>
              {done.status === "pending" ? "Request received — awaiting confirmation" : "Reservation confirmed"}
            </div>
            {done.ref && <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.06em", color: tokens.ink[0], marginTop: 14 }}>{done.ref}</div>}
            <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.9, marginTop: 10, maxWidth: 340, margin: "10px auto 0" }}>
              {done.status === "pending"
                ? "We review larger parties personally — you will hear from us shortly."
                : "We look forward to welcoming you."}
            </div>

            <div style={{ marginTop: 18, textAlign: "left" }}>
              <SummaryRows
                rows={[
                  { k: "Date", v: `${fmtDate(guest.date)} ${guest.date.slice(0, 4)}` },
                  { k: "Time", v: guest.time },
                  { k: "Guests", v: String(guest.pax) },
                  { k: "Name", v: guest.name.trim() },
                ]}
              />
            </div>

            {testMode && (
              <div style={{ border: `1px dashed ${tokens.signal.active}`, background: tokens.neutral[0], padding: "10px 12px", marginTop: 14, fontSize: 9, color: tokens.ink[2], lineHeight: 1.7, textAlign: "left" }}>
                Test booking — nothing was saved. This is exactly what a guest would see; the reference above is not a real reservation.
              </div>
            )}

            {done.manageUrl && (
              <a href={done.manageUrl} style={{ ...secondary, display: "block", textAlign: "center", lineHeight: "48px", textDecoration: "none", marginTop: 14 }}>
                Change or cancel this reservation
              </a>
            )}
          </section>
        )}

        {step === "waitlist" && joinWaitlist && (
          <section>
            <BackLink onClick={() => setStep("date")} />
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.ink[0] }}>Join the waitlist</div>
            <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.8, marginTop: 6 }}>
              Leave your details — we call the moment something opens.
            </div>

            <div style={{ ...eyebrow, margin: "16px 0 6px" }}>Full name</div>
            <input value={waitlist.name} onChange={(event) => setWaitlist({ ...waitlist, name: event.target.value })} placeholder="Name and surname" maxLength={LIMITS.name} style={bigInput} />
            <div style={errorText}>{waitlistErrors.name || ""}</div>

            <div style={{ ...eyebrow, margin: "8px 0 6px" }}>Telephone</div>
            <input value={waitlist.phone} onChange={(event) => setWaitlist({ ...waitlist, phone: event.target.value })} placeholder="+386 …" type="tel" inputMode="tel" maxLength={LIMITS.phone} style={bigInput} />
            <div style={errorText}>{waitlistErrors.phone || ""}</div>

            <div style={{ ...eyebrow, margin: "8px 0 6px" }}>Email (optional)</div>
            <input value={waitlist.email} onChange={(event) => setWaitlist({ ...waitlist, email: event.target.value })} placeholder="you@example.com" type="email" inputMode="email" maxLength={LIMITS.email} style={bigInput} />

            <div style={{ ...eyebrow, margin: "14px 0 8px" }}>When suits you</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {WINDOWS.map((option) => (
                <button key={option} type="button" style={chip(waitlist.window === option, { fs: 9, pad: "10px 11px" })} onClick={() => setWaitlist({ ...waitlist, window: option })}>
                  {option}
                </button>
              ))}
            </div>

            <div style={{ ...errorText, marginTop: 8 }}>{waitlistErrors.submit || ""}</div>

            <button
              type="button"
              style={primary}
              onClick={async () => {
                const next = {};
                if (waitlist.name.trim().length < 2) next.name = "Please enter your name.";
                if (waitlist.phone.replace(/\D/g, "").length < 8) next.phone = "We need a number to call you back.";
                if (Object.keys(next).length) {
                  setWaitlistErrors(next);
                  return;
                }
                try {
                  await joinWaitlist({
                    date: guest.date,
                    pax: guest.pax,
                    name: waitlist.name.trim(),
                    phone: waitlist.phone.trim(),
                    email: waitlist.email.trim(),
                    flexibility: waitlist.window || "Any time",
                  });
                  setWaitlistErrors({});
                  setWaitlistDone({ name: waitlist.name.trim().split(/[ ,]/)[0], phone: waitlist.phone.trim(), pax: guest.pax });
                  setStep("waitlistDone");
                } catch (waitlistError) {
                  setWaitlistErrors({ submit: waitlistError?.message || "We could not add you to the waitlist." });
                }
              }}
            >
              Join waitlist
            </button>
          </section>
        )}

        {step === "waitlistDone" && waitlistDone && (
          <section style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.green.text, fontWeight: 600 }}>You are on the list</div>
            <div style={{ fontSize: 12, color: tokens.ink[0], lineHeight: 1.9, marginTop: 14, maxWidth: 320, margin: "14px auto 0" }}>
              Thank you, {waitlistDone.name}. We will call {waitlistDone.phone} the moment a table for {waitlistDone.pax} opens.
            </div>
          </section>
        )}

        <footer style={{ borderTop: `1px solid ${tokens.ink[5]}`, marginTop: 40, paddingTop: 14, textAlign: "center" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.14em", color: tokens.ink[3], lineHeight: 2, textTransform: "uppercase" }}>
            {config.restaurantName || "Milka"}
            {config.phone ? ` · ${config.phone}` : ""}
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * The manage-link outcome: the booking as the guest sees it, a way to change
 * or cancel, and an honest expired state when the link has been spent.
 */
export function ManageBooking({ booking, expired, onCancel, onChange, restaurantName = "Restaurant", phone }) {
  const [mode, setMode] = useState("view");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode("view");
  }, [booking?.id]);

  if (expired || !booking) {
    return (
      <div style={page}>
        <div style={{ ...column, textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.red.text, fontWeight: 600, marginTop: 40 }}>
            Link expired or invalid
          </div>
          <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.9, marginTop: 14, maxWidth: 320, margin: "14px auto 0" }}>
            This manage link is no longer active — the reservation may have been cancelled, or already taken place.
            {phone ? ` Please call ${restaurantName} on ${phone} if you need help.` : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={column}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.green.text, fontWeight: 600 }}>
            {booking.status === "pending" ? "Awaiting confirmation" : "Confirmed"}
          </div>
          {booking.ref && <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.06em", color: tokens.ink[0], marginTop: 10 }}>{booking.ref}</div>}
        </div>

        <div style={{ marginTop: 16 }}>
          <SummaryRows
            rows={[
              { k: "Date", v: `${fmtDate(booking.date)} ${String(booking.date).slice(0, 4)}` },
              { k: "Time", v: booking.time },
              { k: "Guests", v: String(booking.pax) },
              { k: "Name", v: booking.name },
            ]}
          />
        </div>

        {mode === "view" && (
          <>
            {onChange && (
              <button type="button" style={secondary} onClick={onChange}>
                Change time
              </button>
            )}
            <button type="button" style={{ ...secondary, borderColor: tokens.red.border, background: tokens.red.bg, color: tokens.red.text }} onClick={() => setMode("cancel")}>
              Cancel reservation
            </button>
          </>
        )}

        {mode === "cancel" && (
          <div style={{ border: `1px solid ${tokens.red.border}`, background: tokens.neutral[0], padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.red.text, fontWeight: 600 }}>
              Cancel {booking.ref || "this reservation"}
            </div>
            <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.8, marginTop: 10 }}>
              This releases your table, and the manage link stops working afterwards.
            </div>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (optional)" style={{ ...bigInput, fontSize: 14, marginTop: 12 }} />
            {error && <div style={errorText}>{error}</div>}
            <button
              type="button"
              disabled={busy}
              style={{ ...secondary, borderColor: tokens.red.border, background: tokens.red.bg, color: tokens.red.text }}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onCancel(reason.trim());
                  setMode("done");
                } catch (cancelError) {
                  setError(cancelError?.message || "We could not cancel that just now.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Cancelling…" : "Yes — cancel it"}
            </button>
            <button type="button" style={{ ...secondary, marginTop: 8 }} onClick={() => setMode("view")}>
              Keep the reservation
            </button>
          </div>
        )}

        {mode === "done" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[3], fontWeight: 600 }}>Reservation cancelled</div>
            <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.9, marginTop: 14 }}>
              Your table has been released. We hope to welcome you another time.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BackLink({ onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ border: "none", background: "none", color: tokens.ink[3], fontSize: 9, letterSpacing: "0.12em", padding: "6px 0", marginBottom: 8, cursor: "pointer", fontFamily: FONT, textTransform: "uppercase" }}>
      ← Back
    </button>
  );
}

function SummaryRows({ rows }) {
  return (
    <div style={{ border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0] }}>
      {rows.map((row) => (
        <div key={row.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 12px", borderBottom: `1px solid ${tokens.neutral[100]}` }}>
          <span style={{ fontSize: 8, letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase" }}>{row.k}</span>
          <span style={{ fontSize: 11, color: tokens.ink[0], textAlign: "right", fontWeight: 500 }}>{row.v}</span>
        </div>
      ))}
    </div>
  );
}

function Checkbox({ checked, onToggle, label, muted }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "none", background: "none", padding: muted ? "10px 0 0" : "12px 0 0", textAlign: "left", width: "100%", cursor: "pointer", fontFamily: FONT }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          border: `1px solid ${checked ? tokens.charcoal.default : tokens.ink[4]}`,
          background: checked ? tokens.charcoal.default : tokens.neutral[0],
          color: tokens.neutral[0],
          fontSize: 11,
          lineHeight: "16px",
          textAlign: "center",
          flexShrink: 0,
          display: "inline-block",
        }}
      >
        {checked ? "✓" : ""}
      </span>
      <span style={{ fontSize: 9, color: muted ? tokens.ink[3] : tokens.ink[2], lineHeight: 1.7, flex: 1 }}>{label}</span>
    </button>
  );
}
