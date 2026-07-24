import React, { useMemo, useState } from "react";
import { evaluateAvailability, resolveServicesForDate } from "../domain/reservations/availability.js";
import { statusLabel } from "../domain/reservations/lifecycle.js";
import { formatLongDate, localISODate, shiftISODate, staffAction } from "./reservationClient.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS = [
  ["daybook", "Day Book"],
  ["calendar", "Calendar"],
  ["waitlist", "Waitlist"],
  ["guests", "Guests"],
  ["admin", "Admin"],
];

function serviceLabel(service) {
  return String(service || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}><i />{statusLabel(status)}</span>;
}

function EmptyState({ title, children }) {
  return <div className="empty-state"><strong>{title}</strong><p>{children}</p></div>;
}

function BookingForm({ initial, state, onClose, onSaved }) {
  const services = resolveServicesForDate(initial?.date || localISODate(), state.services, state.exceptions);
  const startingService = initial?.service || services[0]?.service || "dinner";
  const availability = evaluateAvailability({
    date: initial?.date || localISODate(),
    pax: Number(initial?.pax || 2),
    services: state.services,
    exceptions: state.exceptions,
    bookings: state.bookings,
    config: state.config,
  });
  const [form, setForm] = useState({
    id: initial?.id || null,
    date: initial?.date || localISODate(),
    service: startingService,
    time: initial?.time || "",
    pax: Number(initial?.pax || 2),
    name: initial?.name || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    language: initial?.language || "en",
    experience: initial?.experience || "",
    occasion: initial?.occasion || "",
    notes: initial?.notes || "",
    allergiesText: (initial?.allergies || []).join(", "),
    accessibilityText: (initial?.accessibility || []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const servicesForForm = evaluateAvailability({
    date: form.date,
    pax: Number(form.pax),
    services: state.services,
    exceptions: state.exceptions,
    bookings: state.bookings.filter((booking) => booking.id !== form.id),
    config: state.config,
  });
  const slots = servicesForForm.find((item) => item.service === form.service)?.slots || [];
  const update = (key) => (event) => setForm((current) => ({
    ...current,
    [key]: event.target.type === "number" ? Number(event.target.value) : event.target.value,
  }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const booking = {
        ...form,
        allergies: form.allergiesText ? [form.allergiesText] : [],
        accessibility: form.accessibilityText ? [form.accessibilityText] : [],
        source: initial?.source || "staff",
        idempotencyKey: form.id ? undefined : crypto.randomUUID(),
      };
      if (form.id) await staffAction("updateBooking", { booking });
      else await staffAction("createBooking", { booking });
      await onSaved();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="reservation-sheet" onSubmit={save} aria-label={form.id ? "Edit reservation" : "New reservation"}>
      <header className="sheet-header">
        <div><span className="eyebrow">{form.id ? "Edit reservation" : "New reservation"}</span><h2>{form.name || "Guest details"}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="sheet-grid">
        <label><span>Date</span><input type="date" required value={form.date} onChange={update("date")} /></label>
        <label><span>Party size</span><input type="number" min="1" max="30" required value={form.pax} onChange={update("pax")} /></label>
        <label><span>Service</span><select required value={form.service} onChange={update("service")}>
          {servicesForForm.map((service) => <option key={service.service} value={service.service}>{serviceLabel(service.service)}</option>)}
        </select></label>
        <label><span>Time</span><select required value={form.time} onChange={update("time")}>
          <option value="">Choose time</option>
          {slots.map((slot) => <option key={slot.time} value={slot.time} disabled={!slot.ok && slot.time !== initial?.time}>{slot.time}{slot.ok ? "" : " · full"}</option>)}
        </select></label>
        <label><span>Name</span><input required value={form.name} onChange={update("name")} /></label>
        <label><span>Phone</span><input value={form.phone} onChange={update("phone")} inputMode="tel" /></label>
        <label><span>Email</span><input type="email" value={form.email} onChange={update("email")} /></label>
        <label><span>Language</span><select value={form.language} onChange={update("language")}><option value="en">English</option><option value="sl">Slovenščina</option></select></label>
        <label><span>Experience</span><input value={form.experience} onChange={update("experience")} placeholder="Tasting menu" /></label>
        <label><span>Occasion</span><input value={form.occasion} onChange={update("occasion")} placeholder="Birthday…" /></label>
        <label className="wide"><span>Allergies</span><textarea value={form.allergiesText} onChange={update("allergiesText")} /></label>
        <label className="wide"><span>Accessibility</span><textarea value={form.accessibilityText} onChange={update("accessibilityText")} /></label>
        <label className="wide"><span>Staff notes</span><textarea value={form.notes} onChange={update("notes")} /></label>
      </div>
      {servicesForForm.length === 0 && <p className="form-error">No reservation service is offered on this date. Add a date exception in Admin.</p>}
      {error && <p className="form-error">{error}</p>}
      <footer className="sheet-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={saving || servicesForForm.length === 0}>{saving ? "Saving…" : "Save reservation"}</button>
      </footer>
    </form>
  </div>;
}

function DayBook({ state, date, setDate, refresh, openBooking }) {
  const [view, setView] = useState("list");
  const offeredServices = resolveServicesForDate(date, state.services, state.exceptions);
  const bookings = state.bookings
    .filter((booking) => booking.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
  const activeBookings = bookings.filter((booking) => !["cancelled", "no_show"].includes(booking.status));
  const totalCovers = activeBookings.reduce((total, booking) => total + booking.pax, 0);
  const pending = bookings.filter((booking) => booking.status === "pending").length;

  async function transition(booking, toStatus) {
    let reason = "";
    if (toStatus === "cancelled" || toStatus === "no_show") {
      reason = window.prompt(`Reason for ${toStatus === "cancelled" ? "cancellation" : "no-show"}:`, "") || "";
      if (!reason) return;
    }
    try {
      await staffAction("transition", { bookingId: booking.id, toStatus, reason });
      await refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  return <>
    <section className="day-toolbar">
      <div className="date-navigation">
        <button className="icon-button" onClick={() => setDate(shiftISODate(date, -1))} aria-label="Previous day">←</button>
        <div><span className="eyebrow">Selected date</span><h1>{formatLongDate(date)}</h1></div>
        <button className="icon-button" onClick={() => setDate(shiftISODate(date, 1))} aria-label="Next day">→</button>
      </div>
      <div className="toolbar-actions">
        <button className="secondary-button" onClick={() => setDate(localISODate())}>Today</button>
        <input className="compact-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Choose date" />
        <button className="primary-button" onClick={() => openBooking({ date })}>+ New reservation</button>
      </div>
    </section>

    <section className="stat-grid">
      <article><span>Reservations</span><strong>{activeBookings.length}</strong></article>
      <article><span>Expected covers</span><strong>{totalCovers}</strong></article>
      <article><span>Pending</span><strong>{pending}</strong></article>
      <article><span>Services</span><strong>{offeredServices.length || "Closed"}</strong></article>
    </section>

    <section className="panel">
      <header className="panel-header">
        <div><span className="eyebrow">Day Book</span><h2>Reservations and expected arrivals</h2></div>
        <div className="segmented"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button><button className={view === "timeline" ? "active" : ""} onClick={() => setView("timeline")}>Timeline</button></div>
      </header>
      {offeredServices.length === 0 && <div className="notice">No Lunch or Dinner service is offered on this date. Staff can add an exception in Admin.</div>}
      {bookings.length === 0 ? <EmptyState title="No reservations yet">This date is ready for bookings. Use “New reservation” or test the public booking page.</EmptyState> : (
        view === "list"
          ? <div className="reservation-list">{bookings.map((booking) => <article className="reservation-row" key={booking.id}>
              <button className="reservation-main" onClick={() => openBooking(booking)}>
                <time>{booking.time}</time>
                <div className="guest-block"><strong>{booking.name}</strong><span>{booking.pax} guests · {serviceLabel(booking.service)}{booking.tableLabel ? ` · ${booking.tableLabel}` : ""}</span></div>
                <div className="reservation-flags">
                  {booking.allergies?.length > 0 && <span className="flag flag-alert">Allergy</span>}
                  {booking.accessibility?.length > 0 && <span className="flag">Access</span>}
                  {booking.source === "web" && <span className="flag">Web</span>}
                </div>
              </button>
              <div className="row-status"><StatusPill status={booking.status} /></div>
              <div className="row-actions">
                {booking.status === "pending" && <button onClick={() => transition(booking, "confirmed")}>Confirm</button>}
                {booking.status === "confirmed" && <button onClick={() => transition(booking, "arrived")}>Arrived</button>}
                {booking.status === "confirmed" && <button onClick={() => transition(booking, "no_show")}>No-show</button>}
                {booking.status === "arrived" && <button onClick={() => transition(booking, "completed")}>Complete</button>}
                {["pending", "confirmed"].includes(booking.status) && <button className="danger-text" onClick={() => transition(booking, "cancelled")}>Cancel</button>}
              </div>
            </article>)}</div>
          : <div className="timeline">
              <div className="timeline-hours">{Array.from({ length: 19 }, (_, index) => 11 + (index * 0.5)).map((hour) => <span key={hour}>{String(Math.floor(hour)).padStart(2, "0")}:{hour % 1 ? "30" : "00"}</span>)}</div>
              <div className="timeline-lanes">{bookings.map((booking) => {
                const [hours, minutes] = booking.time.split(":").map(Number);
                const left = Math.max(0, Math.min(100, (((hours * 60 + minutes) - 660) / 540) * 100));
                return <button key={booking.id} className={`timeline-booking status-${booking.status}`} style={{ left: `${left}%` }} onClick={() => openBooking(booking)}><strong>{booking.name}</strong><span>{booking.time} · {booking.pax}</span></button>;
              })}</div>
            </div>
      )}
    </section>
  </>;
}

function CalendarView({ state, date, setDate, setTab, openBooking }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const year = first.getUTCFullYear();
  const monthIndex = first.getUTCMonth();
  const leading = first.getUTCDay();
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = [...Array(leading).fill(null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  function shiftMonth(amount) {
    const value = new Date(Date.UTC(year, monthIndex + amount, 1));
    setMonth(value.toISOString().slice(0, 7));
  }

  return <section className="panel calendar-panel">
    <header className="panel-header">
      <div><span className="eyebrow">Calendar</span><h1>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h1></div>
      <div className="toolbar-actions"><button className="icon-button" onClick={() => shiftMonth(-1)}>←</button><button className="secondary-button" onClick={() => setMonth(localISODate().slice(0, 7))}>This month</button><button className="icon-button" onClick={() => shiftMonth(1)}>→</button></div>
    </header>
    <div className="calendar-grid calendar-weekdays">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
    <div className="calendar-grid">
      {cells.map((cell, index) => {
        if (!cell) return <div className="calendar-cell is-empty" key={`empty-${index}`} />;
        const bookings = state.bookings.filter((booking) => booking.date === cell && !["cancelled", "no_show"].includes(booking.status));
        const covers = bookings.reduce((total, booking) => total + booking.pax, 0);
        const services = resolveServicesForDate(cell, state.services, state.exceptions);
        const rule = state.exceptions.find((item) => item.date === cell && ["closed", "private_event"].includes(item.kind));
        return <button
          className={`calendar-cell ${cell === date ? "is-selected" : ""} ${rule ? "is-closed" : ""}`}
          key={cell}
          onClick={() => { setDate(cell); setTab("daybook"); }}
        >
          <strong>{Number(cell.slice(-2))}</strong>
          {rule ? <span className="calendar-rule">{rule.label || serviceLabel(rule.kind)}</span> : <>
            <span>{bookings.length} res · {covers} covers</span>
            <small>{services.map((service) => service.service[0].toUpperCase()).join(" · ") || "No service"}</small>
          </>}
        </button>;
      })}
    </div>
    <footer className="calendar-footer"><button className="primary-button" onClick={() => openBooking({ date })}>+ Book selected date</button><span>Lunch appears only on weekdays enabled in Admin.</span></footer>
  </section>;
}

function WaitlistView({ state, date, refresh, openBooking }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ date, service: "", time: "", name: "", phone: "", email: "", pax: 2, quotedMinutes: 30, notes: "" });
  const entries = state.waitlist.filter((entry) => entry.status === "waiting" || entry.status === "contacted");
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function add(event) {
    event.preventDefault();
    await staffAction("addWaitlist", { entry: form });
    setAdding(false);
    await refresh();
  }

  async function updateEntry(entry, status) {
    let removedReason = "";
    if (status === "removed") {
      removedReason = window.prompt("Why is this party being removed?", "") || "";
      if (!removedReason) return;
    }
    await staffAction("updateWaitlist", { id: entry.id, patch: { status, removedReason } });
    await refresh();
  }

  return <section className="panel">
    <header className="panel-header"><div><span className="eyebrow">Waitlist</span><h1>Unplaced demand</h1></div><button className="primary-button" onClick={() => setAdding(true)}>+ Add party</button></header>
    {entries.length === 0 ? <EmptyState title="Waitlist is clear">Parties from the public booking page and staff entries will appear here.</EmptyState> : <div className="reservation-list">
      {entries.map((entry) => <article className="reservation-row" key={entry.id}>
        <div className="reservation-main">
          <time>{entry.time || entry.window || "Flexible"}</time>
          <div className="guest-block"><strong>{entry.name}</strong><span>{entry.pax} guests · {entry.date} · {entry.phone || entry.email}</span></div>
        </div>
        <div className="row-status"><StatusPill status={entry.status} /></div>
        <div className="row-actions">
          <button onClick={() => updateEntry(entry, "contacted")}>Contacted</button>
          <button onClick={() => openBooking({ date: entry.date, service: entry.service, time: entry.time, pax: entry.pax, name: entry.name, phone: entry.phone, email: entry.email, source: "waitlist" })}>Convert</button>
          <button className="danger-text" onClick={() => updateEntry(entry, "removed")}>Remove</button>
        </div>
      </article>)}
    </div>}
    {adding && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAdding(false)}>
      <form className="reservation-sheet reservation-sheet--small" onSubmit={add}>
        <header className="sheet-header"><div><span className="eyebrow">Waitlist</span><h2>Add party</h2></div><button type="button" className="icon-button" onClick={() => setAdding(false)}>×</button></header>
        <div className="sheet-grid">
          <label><span>Date</span><input type="date" required value={form.date} onChange={update("date")} /></label>
          <label><span>Party size</span><input type="number" min="1" max="30" required value={form.pax} onChange={update("pax")} /></label>
          <label><span>Name</span><input required value={form.name} onChange={update("name")} /></label>
          <label><span>Phone</span><input required value={form.phone} onChange={update("phone")} /></label>
          <label><span>Preferred time</span><input type="time" value={form.time} onChange={update("time")} /></label>
          <label><span>Quoted minutes</span><input type="number" min="0" value={form.quotedMinutes} onChange={update("quotedMinutes")} /></label>
          <label className="wide"><span>Notes</span><textarea value={form.notes} onChange={update("notes")} /></label>
        </div>
        <footer className="sheet-actions"><button type="button" className="secondary-button" onClick={() => setAdding(false)}>Cancel</button><button className="primary-button">Add to waitlist</button></footer>
      </form>
    </div>}
  </section>;
}

function GuestsView({ state, openBooking }) {
  const [query, setQuery] = useState("");
  const guests = state.guests.filter((guest) => `${guest.name} ${guest.email || ""} ${guest.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel">
    <header className="panel-header"><div><span className="eyebrow">Guests</span><h1>Guest directory</h1></div><input className="search-input" placeholder="Search guests…" value={query} onChange={(event) => setQuery(event.target.value)} /></header>
    {guests.length === 0 ? <EmptyState title="No guest profiles yet">Profiles are created automatically from reservations.</EmptyState> : <div className="guest-grid">{guests.map((guest) => <article className="guest-card" key={guest.id}>
      <div className="guest-monogram">{guest.name.slice(0, 2).toUpperCase()}</div>
      <div><h3>{guest.name}</h3><p>{guest.phone || guest.email || "No contact details"}</p><span>{guest.visit_count || 0} completed visits</span></div>
      <button className="secondary-button" onClick={() => openBooking({ name: guest.name, phone: guest.phone, email: guest.email, language: guest.language })}>Book again</button>
    </article>)}</div>}
  </section>;
}

function buildScheduleDraft(services) {
  const names = [...new Set(["lunch", "dinner", ...services.map((row) => row.service)])];
  return names.flatMap((service) => WEEKDAYS.map((_, weekday) => {
    const current = services.find((row) => row.service === service && Number(row.weekday) === weekday);
    return current || {
      service,
      weekday,
      enabled: false,
      first: service === "lunch" ? "12:00" : "18:00",
      last: service === "lunch" ? "13:30" : "19:30",
      interval: 30,
      onlineEnabled: true,
    };
  }));
}

function AdminView({ state, refresh }) {
  const [section, setSection] = useState("schedule");
  const [config, setConfig] = useState(() => structuredClone(state.config));
  const [schedule, setSchedule] = useState(() => buildScheduleDraft(state.services));
  const [rule, setRule] = useState({ date: localISODate(), kind: "closed", label: "", service: "lunch", mode: "off", first: "12:00", last: "13:30", onlineOff: false, capacity: "" });
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const setNested = (group, key, value) => setConfig((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));

  function updateSchedule(service, weekday, patch) {
    setSchedule((rows) => rows.map((row) => row.service === service && row.weekday === weekday ? { ...row, ...patch } : row));
  }

  async function saveSchedule() {
    setSaving("schedule");
    setMessage("");
    try {
      await staffAction("saveSchedule", { services: schedule });
      await refresh();
      setMessage("Weekly services saved. Day Book, Calendar and /book now use this schedule.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving("");
    }
  }

  async function saveConfig() {
    setSaving("config");
    setMessage("");
    try {
      await staffAction("saveConfig", { config });
      await refresh();
      setMessage("Reservation rules saved.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving("");
    }
  }

  async function saveRule(event) {
    event.preventDefault();
    setSaving("rule");
    setMessage("");
    try {
      await staffAction("saveCalendarRule", { rule: { ...rule, capacity: rule.capacity ? Number(rule.capacity) : null } });
      await refresh();
      setMessage("Calendar exception saved.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving("");
    }
  }

  async function deleteRule(id) {
    if (!window.confirm("Remove this date exception?")) return;
    await staffAction("deleteCalendarRule", { id });
    await refresh();
  }

  return <div className="admin-workspace">
    <aside className="admin-nav">
      <div><span className="eyebrow">Admin</span><h2>Reservations</h2></div>
      {[["schedule", "Services & hours"], ["rules", "Booking rules"], ["calendar", "Calendar & closures"], ["privacy", "Guests & privacy"], ["audit", "Audit log"]].map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
      <a href="/book" target="_blank" rel="noreferrer">Preview booking page ↗</a>
    </aside>
    <section className="admin-content">
      {section === "schedule" && <>
        <header className="content-header"><span className="eyebrow">Services & hours</span><h1>When do you take reservations?</h1><p>Lunch and Dinner can be offered on different days. Closed services disappear everywhere.</p></header>
        {["lunch", "dinner"].map((service) => <article className="settings-card" key={service}>
          <header><h2>{serviceLabel(service)}</h2><span>{schedule.filter((row) => row.service === service && row.enabled).length} days a week</span></header>
          <div className="schedule-grid">
            {WEEKDAYS.map((day, weekday) => {
              const row = schedule.find((item) => item.service === service && item.weekday === weekday);
              return <div className={row.enabled ? "schedule-day is-open" : "schedule-day"} key={day}>
                <label className="switch-row"><input type="checkbox" checked={row.enabled} onChange={(event) => updateSchedule(service, weekday, { enabled: event.target.checked })} /><strong>{day}</strong><span>{row.enabled ? "Open" : "Not offered"}</span></label>
                {row.enabled && <div className="schedule-times"><input type="time" value={row.first} onChange={(event) => updateSchedule(service, weekday, { first: event.target.value })} /><span>to</span><input type="time" value={row.last} onChange={(event) => updateSchedule(service, weekday, { last: event.target.value })} /><label><input type="checkbox" checked={row.onlineEnabled} onChange={(event) => updateSchedule(service, weekday, { onlineEnabled: event.target.checked })} /> Online</label></div>}
              </div>;
            })}
          </div>
          <footer><label>Booking interval <select value={schedule.find((row) => row.service === service)?.interval || 30} onChange={(event) => setSchedule((rows) => rows.map((row) => row.service === service ? { ...row, interval: Number(event.target.value) } : row))}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label></footer>
        </article>)}
        <div className="sticky-save"><span>{message}</span><button className="primary-button" onClick={saveSchedule} disabled={saving === "schedule"}>{saving === "schedule" ? "Saving…" : "Save weekly schedule"}</button></div>
      </>}

      {section === "rules" && <>
        <header className="content-header"><span className="eyebrow">Booking rules</span><h1>Keep the pace comfortable</h1><p>These plain-language limits drive staff and public availability together.</p></header>
        <article className="settings-card settings-form">
          <label><span>Guests allowed per arrival time</span><input type="number" min="1" value={config.pacing.coversPerSlot} onChange={(event) => setNested("pacing", "coversPerSlot", Number(event.target.value))} /></label>
          <label><span>Guests allowed per service</span><input type="number" min="1" value={config.pacing.coversPerService} onChange={(event) => setNested("pacing", "coversPerService", Number(event.target.value))} /></label>
          <label><span>Largest online party</span><input type="number" min="1" value={config.online.maxPax} onChange={(event) => setNested("online", "maxPax", Number(event.target.value))} /></label>
          <label><span>Automatically confirm up to</span><input type="number" min="0" value={config.online.autoConfirmMaxPax} onChange={(event) => setNested("online", "autoConfirmMaxPax", Number(event.target.value))} /></label>
          <label><span>Booking window (days)</span><input type="number" min="1" value={config.online.windowDays} onChange={(event) => setNested("online", "windowDays", Number(event.target.value))} /></label>
          <label><span>Same-day notice (minutes)</span><input type="number" min="0" value={config.online.leadMinutes} onChange={(event) => setNested("online", "leadMinutes", Number(event.target.value))} /></label>
        </article>
        <div className="sticky-save"><span>{message}</span><button className="primary-button" onClick={saveConfig} disabled={saving === "config"}>{saving === "config" ? "Saving…" : "Save booking rules"}</button></div>
      </>}

      {section === "calendar" && <>
        <header className="content-header"><span className="eyebrow">Calendar & closures</span><h1>Exceptions to the normal week</h1><p>Add Lunch for one date, remove it, close the restaurant, pause online booking or adjust capacity.</p></header>
        <form className="settings-card settings-form" onSubmit={saveRule}>
          <label><span>Date</span><input type="date" required value={rule.date} onChange={(event) => setRule((current) => ({ ...current, date: event.target.value }))} /></label>
          <label><span>Exception</span><select value={rule.kind} onChange={(event) => setRule((current) => ({ ...current, kind: event.target.value }))}><option value="closed">Restaurant closed</option><option value="private_event">Private event</option><option value="capacity_override">Different capacity</option><option value="service_override">Add/remove a service</option></select></label>
          {rule.kind === "service_override" && <>
            <label><span>Service</span><select value={rule.service} onChange={(event) => setRule((current) => ({ ...current, service: event.target.value }))}><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label>
            <label><span>Action</span><select value={rule.mode} onChange={(event) => setRule((current) => ({ ...current, mode: event.target.value }))}><option value="on">Offer this service</option><option value="off">Do not offer it</option></select></label>
            {rule.mode === "on" && <><label><span>First seating</span><input type="time" value={rule.first} onChange={(event) => setRule((current) => ({ ...current, first: event.target.value }))} /></label><label><span>Last seating</span><input type="time" value={rule.last} onChange={(event) => setRule((current) => ({ ...current, last: event.target.value }))} /></label></>}
            <label className="switch-row"><input type="checkbox" checked={rule.onlineOff} onChange={(event) => setRule((current) => ({ ...current, onlineOff: event.target.checked }))} /><span>Staff-only booking on this date</span></label>
          </>}
          {rule.kind === "capacity_override" && <label><span>Guest capacity</span><input type="number" min="1" required value={rule.capacity} onChange={(event) => setRule((current) => ({ ...current, capacity: event.target.value }))} /></label>}
          <label className="wide"><span>Label or reason</span><input value={rule.label} onChange={(event) => setRule((current) => ({ ...current, label: event.target.value }))} placeholder="Team event, holiday…" /></label>
          <button className="primary-button" disabled={saving === "rule"}>{saving === "rule" ? "Saving…" : "Add exception"}</button>
        </form>
        <div className="exception-list">{state.exceptions.map((item) => <article key={item.id}><time>{item.date}</time><div><strong>{item.label || serviceLabel(item.kind)}</strong><span>{item.service ? `${serviceLabel(item.service)} · ${item.mode}` : serviceLabel(item.kind)}</span></div><button className="danger-text" onClick={() => deleteRule(item.id)}>Remove</button></article>)}</div>
        {message && <p className="save-message">{message}</p>}
      </>}

      {section === "privacy" && <>
        <header className="content-header"><span className="eyebrow">Guests & privacy</span><h1>Guest data, in plain language</h1><p>Guest profiles are reservation-owned and never enter the Service system.</p></header>
        <article className="settings-card settings-form"><label><span>Keep inactive guest profiles for (months)</span><input type="number" min="1" value={config.privacy.retentionMonths} onChange={(event) => setNested("privacy", "retentionMonths", Number(event.target.value))} /></label><div className="notice wide">Exports and anonymisation require Reservations Admin permission. Provider messaging remains disabled in the LAB.</div></article>
        <div className="sticky-save"><span>{message}</span><button className="primary-button" onClick={saveConfig}>Save privacy setting</button></div>
      </>}

      {section === "audit" && <>
        <header className="content-header"><span className="eyebrow">Audit log</span><h1>Every settings change</h1><p>This history belongs only to Reservations.</p></header>
        <div className="audit-list">{state.audit.length ? state.audit.map((item) => <article key={item.id}><time>{new Date(item.occurred_at).toLocaleString()}</time><strong>{item.section}</strong><span>{item.field} · {item.actor}</span></article>) : <EmptyState title="No changes recorded">Saved Admin changes will appear here.</EmptyState>}</div>
      </>}
    </section>
  </div>;
}

export default function StaffWorkspace({ state, refresh, onSignOut }) {
  const [tab, setTab] = useState("daybook");
  const [date, setDate] = useState(localISODate());
  const [bookingDraft, setBookingDraft] = useState(null);
  const pendingCount = state.bookings.filter((booking) => booking.status === "pending").length;
  const waitingCount = state.waitlist.filter((entry) => entry.status === "waiting").length;

  return <main className="reservations-lab">
    <div className="lab-ribbon">ISOLATED RESERVATIONS LAB · TEST DATA ONLY · SERVICE UNTOUCHED</div>
    <header className="staff-header">
      <a className="staff-brand" href="/reservations"><strong>MILKA</strong><span>Reservations</span></a>
      <nav>{TABS.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}{id === "waitlist" && waitingCount > 0 ? <b>{waitingCount}</b> : null}{id === "daybook" && pendingCount > 0 ? <b>{pendingCount}</b> : null}</button>)}</nav>
      <div className="staff-links"><a href="/book" target="_blank" rel="noreferrer">Guest page ↗</a><button onClick={onSignOut}>Lock</button></div>
    </header>
    <div className="mobile-tabbar">{TABS.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="workspace-content">
      {tab === "daybook" && <DayBook state={state} date={date} setDate={setDate} refresh={refresh} openBooking={setBookingDraft} />}
      {tab === "calendar" && <CalendarView state={state} date={date} setDate={setDate} setTab={setTab} openBooking={setBookingDraft} />}
      {tab === "waitlist" && <WaitlistView state={state} date={date} refresh={refresh} openBooking={setBookingDraft} />}
      {tab === "guests" && <GuestsView state={state} openBooking={setBookingDraft} />}
      {tab === "admin" && <AdminView state={state} refresh={refresh} />}
    </div>
    {bookingDraft && <BookingForm initial={bookingDraft} state={state} onClose={() => setBookingDraft(null)} onSaved={refresh} />}
  </main>;
}
