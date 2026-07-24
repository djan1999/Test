import React, { useEffect, useMemo, useState } from "react";
import {
  cancelManagedBooking,
  loadManagedBooking,
  loadPublicAvailability,
  loadPublicConfig,
  localISODate,
  shiftISODate,
  submitPublicBooking,
  submitPublicWaitlist,
} from "./reservationClient.js";

function Field({ label, children, wide = false }) {
  return <label className={wide ? "book-field book-field--wide" : "book-field"}>
    <span>{label}</span>
    {children}
  </label>;
}

function BookingSuccess({ result }) {
  return <section className="book-card book-result" aria-live="polite">
    <div className="book-kicker">Reservation received</div>
    <h2>{result.status === "confirmed" ? "Your table is confirmed." : "We’ll confirm shortly."}</h2>
    <div className="book-reference">{result.ref}</div>
    <p>Keep this reference. You can use the private link below to review or cancel your reservation.</p>
    {result.manageUrl && <a className="primary-button book-full-button" href={result.manageUrl}>Manage reservation</a>}
    <a className="text-link" href="/book">Make another reservation</a>
  </section>;
}

function WaitlistForm({ search, onDone }) {
  const [form, setForm] = useState({
    name: "", phone: "", email: "", window: "Any available time", notes: "",
  });
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setState("saving");
    setError("");
    try {
      await submitPublicWaitlist({ ...search, ...form });
      setState("done");
      onDone?.();
    } catch (requestError) {
      setError(requestError.message);
      setState("idle");
    }
  }

  if (state === "done") {
    return <section className="book-card book-result">
      <div className="book-kicker">Waitlist</div>
      <h2>You’re on the list.</h2>
      <p>We’ll use the contact details you provided if a suitable table becomes available.</p>
      <a className="text-link" href="/book">Back to booking</a>
    </section>;
  }

  return <form className="book-card" onSubmit={submit}>
    <div className="book-kicker">No suitable time?</div>
    <h2>Join the waitlist</h2>
    <p>{search.date} · {search.pax} guests</p>
    <div className="book-form-grid">
      <Field label="Name"><input required value={form.name} onChange={update("name")} /></Field>
      <Field label="Phone"><input required value={form.phone} onChange={update("phone")} inputMode="tel" /></Field>
      <Field label="Email"><input value={form.email} onChange={update("email")} inputMode="email" /></Field>
      <Field label="Preferred window">
        <select value={form.window} onChange={update("window")}>
          <option>Any available time</option>
          <option>Lunch</option>
          <option>Early dinner</option>
          <option>Late dinner</option>
        </select>
      </Field>
      <Field label="Anything we should know?" wide><textarea value={form.notes} onChange={update("notes")} /></Field>
    </div>
    {error && <p className="form-error">{error}</p>}
    <button className="primary-button book-full-button" disabled={state === "saving"}>
      {state === "saving" ? "Joining…" : "Join waitlist"}
    </button>
  </form>;
}

export function ManageBookingPage({ token }) {
  const [booking, setBooking] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    loadManagedBooking(token)
      .then((payload) => {
        setBooking(payload.booking);
        setState("ready");
      })
      .catch((requestError) => {
        setError(requestError.code === "expired_link" ? "This private link has expired." : requestError.message);
        setState("error");
      });
  }, [token]);

  async function cancel() {
    const reason = window.prompt("Please tell us why you are cancelling:", "Plans changed");
    if (!reason) return;
    setState("saving");
    try {
      await cancelManagedBooking(token, reason);
      setBooking((current) => ({ ...current, status: "cancelled" }));
      setState("ready");
    } catch (requestError) {
      setError(requestError.message);
      setState("ready");
    }
  }

  return <main className="public-booking">
    <div className="lab-ribbon">RESERVATIONS LAB · TEST DATA ONLY</div>
    <header className="book-brand"><a href="/book">MILKA</a><span>Manage reservation</span></header>
    <div className="book-shell">
      {state === "loading" && <section className="book-card"><p>Loading reservation…</p></section>}
      {state === "error" && <section className="book-card book-result"><h2>Link unavailable</h2><p>{error}</p><a href="/book">Start a new booking</a></section>}
      {booking && <section className="book-card">
        <div className="book-kicker">Private reservation link</div>
        <h1>{booking.ref}</h1>
        <dl className="manage-summary">
          <div><dt>Guest</dt><dd>{booking.name}</dd></div>
          <div><dt>Date</dt><dd>{booking.date}</dd></div>
          <div><dt>Time</dt><dd>{booking.time}</dd></div>
          <div><dt>Party</dt><dd>{booking.pax} guests</dd></div>
          <div><dt>Status</dt><dd>{booking.status}</dd></div>
        </dl>
        {booking.status !== "cancelled" && <button className="danger-button book-full-button" onClick={cancel} disabled={state === "saving"}>Cancel reservation</button>}
        {error && <p className="form-error">{error}</p>}
      </section>}
    </div>
  </main>;
}

export default function BookingPage() {
  const today = localISODate();
  const [config, setConfig] = useState(null);
  const [search, setSearch] = useState({ date: shiftISODate(today, 1), pax: 2 });
  const [availability, setAvailability] = useState(null);
  const [selection, setSelection] = useState(null);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", language: "en", experience: "Tasting menu",
    allergiesText: "", accessibilityText: "", occasion: "", notes: "", consentNews: false,
  });
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [waitlist, setWaitlist] = useState(false);

  useEffect(() => {
    loadPublicConfig()
      .then((payload) => {
        setConfig(payload.config);
        setState("search");
      })
      .catch((requestError) => {
        setError(requestError.message);
        setState("search");
      });
  }, []);

  const maxDate = useMemo(
    () => shiftISODate(today, Number(config?.online?.windowDays || 90)),
    [config, today],
  );
  const updateForm = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function findTimes(event) {
    event?.preventDefault?.();
    setState("loading");
    setError("");
    setSelection(null);
    try {
      const payload = await loadPublicAvailability(search.date, search.pax);
      setAvailability(payload);
      setState("times");
      if (!payload.anyOk) setWaitlist(false);
    } catch (requestError) {
      setError(requestError.message);
      setState("search");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selection) return;
    setState("saving");
    setError("");
    try {
      const payload = await submitPublicBooking({
        date: search.date,
        pax: Number(search.pax),
        service: selection.service,
        time: selection.time,
        name: form.name,
        phone: form.phone,
        email: form.email,
        language: form.language,
        experience: form.experience,
        allergies: form.allergiesText ? [form.allergiesText] : [],
        accessibility: form.accessibilityText ? [form.accessibilityText] : [],
        occasion: form.occasion,
        notes: form.notes,
        consentNews: form.consentNews,
      }, crypto.randomUUID());
      setResult(payload);
      setState("done");
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.code === "slot_taken") {
        await findTimes();
      } else {
        setState("details");
      }
    }
  }

  if (result) {
    return <main className="public-booking">
      <div className="lab-ribbon">RESERVATIONS LAB · TEST DATA ONLY</div>
      <header className="book-brand"><a href="/book">MILKA</a><span>Reservations</span></header>
      <div className="book-shell"><BookingSuccess result={result} /></div>
    </main>;
  }

  if (waitlist) {
    return <main className="public-booking">
      <div className="lab-ribbon">RESERVATIONS LAB · TEST DATA ONLY</div>
      <header className="book-brand"><a href="/book">MILKA</a><span>Reservations</span></header>
      <div className="book-shell"><WaitlistForm search={search} /></div>
    </main>;
  }

  return <main className="public-booking">
    <div className="lab-ribbon">RESERVATIONS LAB · TEST DATA ONLY</div>
    <header className="book-brand"><a href="/book">MILKA</a><span>Reservations</span></header>
    <div className="book-shell">
      <section className="book-intro">
        <div className="book-kicker">Kranjska Gora · Slovenia</div>
        <h1>{config?.tagline || "A table at Milka"}</h1>
        <p>Choose your date and party size. We’ll show only the services offered that day.</p>
      </section>

      <form className="book-card book-search" onSubmit={findTimes}>
        <Field label="Date">
          <input type="date" min={today} max={maxDate} value={search.date} onChange={(event) => setSearch((current) => ({ ...current, date: event.target.value }))} />
        </Field>
        <Field label="Guests">
          <select value={search.pax} onChange={(event) => setSearch((current) => ({ ...current, pax: Number(event.target.value) }))}>
            {Array.from({ length: Number(config?.online?.maxPax || 6) }, (_, index) => index + 1).map((pax) => <option key={pax} value={pax}>{pax} {pax === 1 ? "guest" : "guests"}</option>)}
          </select>
        </Field>
        <button className="primary-button">Find a table</button>
      </form>

      {availability && <section className="book-card">
        <div className="book-kicker">Available times</div>
        <h2>{search.date} · {search.pax} guests</h2>
        {availability.services.length === 0 && <p>No reservation service is offered on this date.</p>}
        {availability.services.map((service) => <div className="time-group" key={service.service}>
          <h3>{service.service}</h3>
          <div className="time-grid">
            {service.slots.map((slot) => <button
              type="button"
              key={slot.time}
              disabled={!slot.ok}
              className={selection?.service === service.service && selection?.time === slot.time ? "time-button is-selected" : "time-button"}
              onClick={() => {
                setSelection({ service: service.service, time: slot.time });
                setState("details");
              }}
            >{slot.time}</button>)}
          </div>
        </div>)}
        {!availability.anyOk && <button type="button" className="secondary-button book-full-button" onClick={() => setWaitlist(true)}>Join the waitlist</button>}
      </section>}

      {selection && <form className="book-card" onSubmit={submit}>
        <div className="book-kicker">Your details</div>
        <h2>{selection.service} · {selection.time}</h2>
        <div className="book-form-grid">
          <Field label="Name"><input required value={form.name} onChange={updateForm("name")} autoComplete="name" /></Field>
          <Field label="Phone"><input required value={form.phone} onChange={updateForm("phone")} autoComplete="tel" inputMode="tel" /></Field>
          <Field label="Email"><input required type="email" value={form.email} onChange={updateForm("email")} autoComplete="email" /></Field>
          <Field label="Language">
            <select value={form.language} onChange={updateForm("language")}><option value="en">English</option><option value="sl">Slovenščina</option></select>
          </Field>
          <Field label="Experience">
            <select value={form.experience} onChange={updateForm("experience")}><option>Tasting menu</option><option>Lunch experience</option><option>Celebration</option></select>
          </Field>
          <Field label="Occasion"><input value={form.occasion} onChange={updateForm("occasion")} placeholder="Birthday, anniversary…" /></Field>
          <Field label="Allergies" wide><textarea value={form.allergiesText} onChange={updateForm("allergiesText")} placeholder="Please be specific." /></Field>
          <Field label="Accessibility needs" wide><textarea value={form.accessibilityText} onChange={updateForm("accessibilityText")} /></Field>
          <Field label="Requests or notes" wide><textarea value={form.notes} onChange={updateForm("notes")} /></Field>
        </div>
        <label className="consent-row"><input type="checkbox" checked={form.consentNews} onChange={updateForm("consentNews")} /> I would like occasional news from Milka.</label>
        <p className="book-policy">{config?.publicPage?.policies}</p>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button book-full-button" disabled={state === "saving"}>{state === "saving" ? "Confirming…" : "Confirm reservation"}</button>
      </form>}
      {error && !selection && <p className="form-error">{error}</p>}
    </div>
  </main>;
}
