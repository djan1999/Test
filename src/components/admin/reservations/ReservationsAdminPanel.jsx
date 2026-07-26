// ReservationsAdminPanel — reservation settings inside the existing Admin shell.
//
// One panel in the existing admin, reached from the existing admin navigation.
// It draws no header, no page padding, no width cap, no sidebar and no second
// gate — all of those belong to AdminLayout, and drawing them twice is what made
// this read as a second admin application nested in the first. Its section list
// is a row of tabs above the body, not a column beside Admin's own sidebar:
// two nav columns side by side read as two applications no matter how plainly
// the second one is painted. The Admin gate has already authorised whoever is
// reading this. Everything is written in plain restaurant language, with
// steppers and toggles rather than raw fields, and nothing saves until the
// manager has seen a plain-English summary of what will change and what it
// costs them.
//
// Settings here apply to reservations and the guest booking page only. Nothing
// in this file reads or writes service_settings, service_tables, floor maps,
// courses or the live service clock.

import { useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import { FONT, baseInp, dangerBtn, panelBtn, primaryBtn, saveBtn, sectionHeader, toggleBtn } from "../adminStyles.js";
import { RESERVATION_ROLES, normalizeReservationConfig } from "../../../domain/reservations/config.js";
import { dateWeekday, generateSlots, minutesOf, timeOf } from "../../../domain/reservations/availability.js";
import { tablesFromDiningMap } from "../../../domain/reservations/tableImport.js";

// Loop 3 — "take the current dining room". Off by default: a restaurant whose
// floor plan is still being drawn should not have its bookable tables replaced
// by a half-finished one.
const TABLE_IMPORT_ENABLED = import.meta.env.VITE_RESERVATIONS_LOOP3_ENABLED === "true";

// The floor map is READ here and nowhere else in this file, exactly once, to
// produce a copy. Availability never reads it — see tableImport.js.
const activeDiningMap = (floorMaps) => {
  const maps = Array.isArray(floorMaps?.maps) ? floorMaps.maps : [];
  return maps.find((map) => map.id === floorMaps?.activeDiningMapId && map.kind === "dining")
    || maps.find((map) => map.kind === "dining")
    || null;
};

const NAV = [
  ["overview", "Overview", "start here"],
  ["hours", "Services & Hours", "lunch · dinner · seatings"],
  ["calendar", "Calendar & Closures", "days off · events"],
  ["capacity", "Availability & Capacity", "pacing · table time"],
  ["tables", "Tables", "seats · joins"],
  ["rules", "Booking Rules", "confirm · walk-ins"],
  ["experiences", "Experiences", "menus guests choose"],
  ["public", "Public Booking Page", "what guests see"],
  ["messages", "Guest Messages", "confirmation · reminder"],
  ["waitlist", "Waitlist", "quotes · matching"],
  ["privacy", "Guests & Privacy", "retention"],
  ["team", "Permissions", "who can change what"],
  ["audit", "Audit Log", "every change, recorded"],
];

const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SERVICES = ["lunch", "dinner"];
// The two menus Menu Layout builds. `menuType` is the value written onto a
// booking, so these keys must stay "long" and "short" — getAssignedProfile
// reads exactly that word to choose which template the guest menu renders.
const MENU_EXPERIENCES = [
  { key: "long", menuType: "long", title: "Long menu", description: "The full seasonal tasting menu. Allow around three hours." },
  { key: "short", menuType: "short", title: "Short menu", description: "A shorter expression of the season. Allow around two hours." },
];

const card = { background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "14px 16px", marginBottom: 12 };
const label = { fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 6 };
const explain = { fontFamily: FONT, fontSize: 9, color: tokens.ink[3], lineHeight: 1.7, marginTop: 8 };
const clone = (value) => JSON.parse(JSON.stringify(value));

// The booking window is stored in days because that is what the availability
// engine compares against, but a manager thinks in months: "we are open through
// November". These translate between the two and always name the real date, so
// nobody has to work out what 120 days lands on.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const windowEnd = (days) => {
  const end = new Date();
  end.setDate(end.getDate() + Math.max(1, Number(days) || 0));
  return end;
};
export function windowMonthsLabel(days) {
  const months = Math.round((Number(days) || 0) / 30);
  if (months < 1) return `${Math.max(1, Number(days) || 0)} days`;
  return `${months} month${months === 1 ? "" : "s"}`;
}
export function windowEndLabel(days) {
  const end = windowEnd(days);
  return `${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}
/** Step the window by whole months, keeping the stored value in days. */
export function shiftWindowMonths(days, by) {
  const months = Math.max(1, Math.round((Number(days) || 30) / 30) + by);
  return Math.min(365, Math.max(1, months * 30));
}

/** The months a manager can decide about: this month and the next fifteen, so
 *  next year's Christmas can be put on sale while this one is still running.
 *  `rolling` says what the window alone would do with each, so the buttons can
 *  admit that leaving a month on ROLLING currently means shut. */
export function upcomingMonths(windowDays, from = new Date()) {
  const end = new Date(from);
  end.setDate(end.getDate() + Math.max(1, Number(windowDays) || 0));
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`;
  return Array.from({ length: 16 }, (_, index) => {
    const month = new Date(from.getFullYear(), from.getMonth() + index, 1);
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      title: `${MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`,
      rolling: key <= endKey,
    };
  });
}

export default function ReservationsAdminPanel({ config, weeklyServices = [], exceptions = [], bookings = [], audit = [], floorMaps = null, enableTableImport = TABLE_IMPORT_ENABLED, onSeedLab = null, onSave, canEdit = true }) {
  const applied = useMemo(
    () => ({ config: clone(config || {}), weeklyServices: clone(weeklyServices), exceptions: clone(exceptions) }),
    [config, weeklyServices, exceptions],
  );

  const [section, setSection] = useState("overview");
  const [draft, setDraft] = useState(null);
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [scratch, setScratch] = useState({ date: "", label: "", capacity: "", comboA: "", comboB: "", member: "" });

  const current = draft || applied;
  const cfg = current.config;
  const services = current.weeklyServices;
  const rules = current.exceptions;

  const edit = (mutate) => {
    if (!canEdit) return;
    const next = draft ? clone(draft) : clone(applied);
    mutate(next);
    setDraft(next);
    setStatus("idle");
  };

  const changes = useMemo(() => (draft ? computeChanges(applied, draft, bookings) : []), [applied, draft, bookings]);

  const save = async () => {
    if (!draft) return;
    setStatus("saving");
    try {
      await onSave({ config: draft.config, weeklyServices: draft.weeklyServices, exceptions: draft.exceptions, changes });
      setDraft(null);
      setReview(null);
      setStatus("saved");
      setMessage("Saved — live in Reservations and on the guest page.");
    } catch (saveError) {
      setStatus("error");
      setMessage(saveError?.message || "Those settings could not be saved.");
    }
  };

  return (
    <div style={{ fontFamily: FONT, color: tokens.ink[1], paddingBottom: draft ? 76 : 0 }}>
      <div>
        {/* A row of tabs, the idiom every other admin panel uses.
            This was a left-hand column, and a column of links beside Admin's
            own sidebar is what made the whole thing read as one application
            nested in another, however plainly it was painted. There is one
            sidebar on this page and it belongs to Admin. */}
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
          {NAV.map(([key, title, sub]) => (
            <button
              key={key}
              type="button"
              title={sub}
              onClick={() => setSection(key)}
              style={{ ...panelBtn(section === key), minHeight: 30 }}
            >
              {title}
            </button>
          ))}
        </nav>

        {/* No padding and no width cap here: AdminLayout's <main> already sets
            the page padding and content column every other panel sits in, and a
            second set of both is what made this read as an admin inside an
            admin. */}
        <div style={{ borderTop: `1px solid ${tokens.ink[4]}`, paddingTop: 16 }}>
          {section === "overview" && <Overview cfg={cfg} services={services} onGo={setSection} onSeedLab={onSeedLab} />}

          {section === "hours" && <ServicesAndHours services={services} cfg={cfg} edit={edit} canEdit={canEdit} />}

          {section === "calendar" && (
            <CalendarClosures rules={rules} edit={edit} scratch={scratch} setScratch={setScratch} canEdit={canEdit} setMessage={setMessage} />
          )}

          {section === "capacity" && <Capacity cfg={cfg} edit={edit} />}

          {section === "tables" && <Tables cfg={cfg} edit={edit} scratch={scratch} setScratch={setScratch} setMessage={setMessage} floorMaps={floorMaps} enableImport={enableTableImport} />}

          {section === "rules" && <BookingRules cfg={cfg} edit={edit} />}

          {section === "experiences" && <Experiences cfg={cfg} edit={edit} />}

          {section === "public" && <PublicPage cfg={cfg} edit={edit} />}

          {section === "messages" && <Messages cfg={cfg} edit={edit} />}

          {section === "waitlist" && <WaitlistSettings cfg={cfg} edit={edit} />}

          {section === "privacy" && <Privacy cfg={cfg} edit={edit} />}

          {section === "team" && <Team cfg={cfg} edit={edit} scratch={scratch} setScratch={setScratch} />}

          {section === "audit" && <AuditLog audit={audit} />}
        </div>
      </div>

      {draft && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: tokens.neutral[0],
            borderTop: `1px solid ${tokens.charcoal.default}`,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 9, letterSpacing: "0.12em", color: tokens.signal.warn, fontWeight: 600, textTransform: "uppercase" }}>
            Unsaved changes — {changes.length} setting{changes.length === 1 ? "" : "s"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={saveBtn("idle")} onClick={() => { setDraft(null); setMessage("Changes discarded — nothing was saved."); }}>
              Cancel
            </button>
            <button type="button" style={primaryBtn} onClick={() => setReview(changes.length ? changes : [{ label: "No effective change", from: "—", to: "—" }])}>
              What will change?
            </button>
          </div>
        </div>
      )}

      {review && (
        <div style={{ position: "fixed", inset: 0, background: tokens.surface.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2600, padding: 16 }}>
          <div style={{ width: "min(620px,96vw)", maxHeight: "88vh", overflow: "auto", background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`, padding: 18 }}>
            <div style={{ ...sectionHeader, marginBottom: 12 }}>What will change</div>
            {review.map((row, index) => (
              <div key={index} style={{ borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "8px 0" }}>
                <div style={{ fontSize: 11, color: tokens.ink[0] }}>{row.label}</div>
                <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 3 }}>
                  {row.from} → <span style={{ color: tokens.ink[0], fontWeight: 600 }}>{row.to}</span>
                </div>
                {row.warning && (
                  <div style={{ fontSize: 9, color: tokens.signal.warn, fontWeight: 600, marginTop: 3, lineHeight: 1.6 }}>{row.warning}</div>
                )}
              </div>
            ))}
            <div style={explain}>
              Applies immediately to the Day Book, Timeline, Calendar and the guest booking page. Every change is written to the audit log.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" style={saveBtn("idle")} onClick={() => setReview(null)}>
                Keep editing
              </button>
              <button type="button" style={primaryBtn} disabled={status === "saving"} onClick={save}>
                {status === "saving" ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 14,
            zIndex: 2700,
            background: status === "error" ? tokens.red.bg : tokens.green.bg,
            border: `1px solid ${status === "error" ? tokens.red.border : tokens.green.border}`,
            color: status === "error" ? tokens.red.text : tokens.green.text,
            padding: "10px 14px",
            fontSize: 9,
            letterSpacing: "0.10em",
            fontWeight: 600,
            fontFamily: FONT,
            maxWidth: "calc(100vw - 32px)",
          }}
          onClick={() => setMessage("")}
          role="status"
        >
          {message}
        </div>
      )}
    </div>
  );
}

/* ── shared controls ─────────────────────────────────────────────────────── */

function Stepper({ value, onDown, onUp, width = 92, size = 34 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" onClick={onDown} style={{ ...saveBtn("idle"), width: size, height: size, padding: 0 }}>
        −
      </button>
      <span style={{ fontSize: size >= 34 ? 14 : 12, minWidth: width, textAlign: "center", fontWeight: 600, color: tokens.ink[0] }}>{value}</span>
      <button type="button" onClick={onUp} style={{ ...saveBtn("idle"), width: size, height: size, padding: 0 }}>
        +
      </button>
    </div>
  );
}

/* ── sections ────────────────────────────────────────────────────────────── */

function Overview({ cfg, services, onGo, onSeedLab }) {
  const enabledFor = (service) => services.filter((row) => row.service === service && row.enabled);
  const summarise = (service) => {
    const rows = enabledFor(service);
    if (!rows.length) return "not served";
    const days = WEEKDAYS.filter(([n]) => rows.some((row) => Number(row.weekday) === n)).map(([, short]) => short);
    return `${days.join(" ")} · ${rows[0].first}–${rows[0].last}`;
  };

  const cards = [
    ["When are we open?", `Dinner ${summarise("dinner")}. Lunch ${summarise("lunch")}.`, "Services & Hours", "hours"],
    ["How should bookings work?", `Auto-confirm to ${cfg.online?.autoConfirmMaxPax ?? 4} guests; larger parties reviewed by staff.`, "Booking Rules", "rules"],
    ["How many guests can we accept?", `${cfg.pacing?.coversPerSlot ?? 12} per seating, ${cfg.pacing?.coversPerService ?? 44} per service.`, "Availability & Capacity", "capacity"],
    ["Which tables can be booked?", `${(cfg.tables || []).length} tables, ${(cfg.combos || []).length} joinable pairs.`, "Tables", "tables"],
    ["What will guests see?", `“${String(cfg.tagline || "").slice(0, 46)}…”`, "Public Booking Page", "public"],
    ["What messages should guests receive?", "Confirmation, reminder and three more — drafts until a provider is connected.", "Guest Messages", "messages"],
    ["Who can change Reservations?", `${(cfg.team || []).length} people · roles from admin to read-only.`, "Permissions", "team"],
  ];

  return (
    <>
      <div style={sectionHeader}>Reservations — overview</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
        {cards.map(([question, answer, go, key]) => (
          <button
            key={key}
            type="button"
            onClick={() => onGo(key)}
            style={{ textAlign: "left", background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "14px 16px", fontFamily: FONT, cursor: "pointer" }}
          >
            <div style={{ fontSize: 12, color: tokens.ink[0], fontWeight: 500 }}>{question}</div>
            <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.7, marginTop: 5 }}>{answer}</div>
            <div style={{ fontSize: 8, letterSpacing: "0.10em", color: tokens.green.text, marginTop: 8 }}>{go} →</div>
          </button>
        ))}
      </div>
      {onSeedLab && <SeedLabCard onSeedLab={onSeedLab} />}
    </>
  );
}

/**
 * LAB seeding. Present only when the build asks for it, and refused by the
 * server unless it is the LAB workspace with seeding switched on — so this
 * cannot reach a restaurant's real book even if the button is rendered by
 * mistake. Everything it writes is fictional and safe to write twice: the same
 * day always produces the same world, so a second run overwrites the first.
 */
function SeedLabCard({ onSeedLab }) {
  const [state, setState] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [problem, setProblem] = useState("");

  const run = async () => {
    setState("working");
    setProblem("");
    try {
      setSummary(await onSeedLab({}));
      setState("done");
    } catch (error) {
      setProblem(error?.message || "Seeding failed.");
      setState("idle");
    }
  };

  return (
    <div style={{ ...card, marginTop: 14, borderColor: tokens.signal.warn }}>
      <div style={label}>LAB — fill the book with fictional service</div>
      <div style={explain}>
        Writes about three months of finished service, a full evening today and four weeks ahead: regulars on their own
        cadences, a few no-shows, parties of eight on two tables pushed together. Everything is invented, and running it
        again writes over the same rows rather than filing a second summer.
      </div>
      {problem && (
        <div role="alert" style={{ fontSize: 10, color: tokens.red.text, marginTop: 8, lineHeight: 1.6 }}>{problem}</div>
      )}
      {summary && state === "done" && (
        <div role="status" style={{ fontSize: 10, color: tokens.ink[1], marginTop: 8, lineHeight: 1.7 }}>
          {summary.bookings} bookings · {summary.guests} guests · {summary.combined} on joined tables ·{" "}
          {summary.from} → {summary.to}
        </div>
      )}
      <button type="button" style={{ ...saveBtn("idle"), marginTop: 10 }} disabled={state === "working"} onClick={run}>
        {state === "working" ? "Filling the book…" : "Seed the LAB"}
      </button>
    </div>
  );
}

function ServicesAndHours({ services, cfg, edit, canEdit }) {
  const rowFor = (service, weekday) => services.find((row) => row.service === service && Number(row.weekday) === weekday);

  const setDay = (service, weekday, mutate) =>
    edit((next) => {
      let row = next.weeklyServices.find((item) => item.service === service && Number(item.weekday) === weekday);
      if (!row) {
        row = { service, weekday, enabled: false, first: service === "lunch" ? "12:00" : "18:00", last: service === "lunch" ? "13:30" : "19:30", interval: 30, onlineEnabled: true };
        next.weeklyServices.push(row);
      }
      mutate(row);
    });

  return (
    <>
      <div style={sectionHeader}>Services &amp; hours</div>
      {["dinner", "lunch"].map((service) => {
        const openDays = services.filter((row) => row.service === service && row.enabled);
        const sample = openDays[0];
        return (
          <div key={service} style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tokens.ink[0], textTransform: "capitalize" }}>{service}</div>
            <div style={{ ...label, margin: "12px 0 4px" }}>
              Which days do you serve {service}? Tap a day, then set its first and last seating.
            </div>

            {WEEKDAYS.map(([weekday, short]) => {
              const row = rowFor(service, weekday);
              const on = Boolean(row?.enabled);
              const step = Number(row?.interval || 30);
              return (
                <div key={weekday} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "6px 0", flexWrap: "wrap" }}>
                  <button type="button" disabled={!canEdit} style={{ ...toggleBtn(on), width: 58, textAlign: "center" }} onClick={() => setDay(service, weekday, (r) => { r.enabled = !on; })}>
                    {short}
                  </button>

                  {on ? (
                    <>
                      <Stepper
                        size={30}
                        width={48}
                        value={row.first}
                        onDown={() => setDay(service, weekday, (r) => { r.first = timeOf(Math.max(0, minutesOf(r.first) - step)); })}
                        onUp={() => setDay(service, weekday, (r) => { r.first = timeOf(Math.min(minutesOf(r.last), minutesOf(r.first) + step)); })}
                      />
                      <span style={{ fontSize: 9, color: tokens.ink[3] }}>to</span>
                      <Stepper
                        size={30}
                        width={48}
                        value={row.last}
                        onDown={() => setDay(service, weekday, (r) => { r.last = timeOf(Math.max(minutesOf(r.first), minutesOf(r.last) - step)); })}
                        onUp={() => setDay(service, weekday, (r) => { r.last = timeOf(minutesOf(r.last) + step); })}
                      />
                      <button
                        type="button"
                        disabled={!canEdit}
                        style={{ ...saveBtn("idle"), borderStyle: "dashed" }}
                        onClick={() =>
                          edit((next) => {
                            next.weeklyServices.forEach((item) => {
                              if (item.service === service && item.enabled) {
                                item.first = row.first;
                                item.last = row.last;
                                item.interval = row.interval;
                              }
                            });
                          })
                        }
                      >
                        Copy → all open days
                      </button>
                      <button
                        type="button"
                        style={toggleBtn(row.onlineEnabled !== false)}
                        onClick={() => setDay(service, weekday, (r) => { r.onlineEnabled = !(r.onlineEnabled !== false); })}
                      >
                        {row.onlineEnabled !== false ? "Online on" : "Staff only"}
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 9, letterSpacing: "0.06em", color: tokens.ink[4] }}>Not served this day</span>
                  )}
                </div>
              );
            })}

            <div style={explain}>
              {openDays.length
                ? `${openDays.length} day${openDays.length > 1 ? "s" : ""} a week · guests choose ${generateSlots(sample.first, sample.last, sample.interval).join(" · ")}. Date exceptions live in Calendar & Closures.`
                : `No days selected — ${service} never appears, online or at the desk.`}
            </div>
          </div>
        );
      })}

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <div>
            <div style={label}>How close to arrival can guests book?</div>
            <Stepper
              value={`${cfg.online?.leadMinutes ?? 30} min`}
              onDown={() => edit((next) => { next.config.online.leadMinutes = Math.max(0, (next.config.online.leadMinutes ?? 30) - 15); })}
              onUp={() => edit((next) => { next.config.online.leadMinutes = Math.min(240, (next.config.online.leadMinutes ?? 30) + 15); })}
            />
          </div>
          <div>
            {/* Restaurants open the book by the month — "we are taking bookings
                through November" — so the step is a month and the exact date it
                lands on is spelled out underneath. The stored value stays
                windowDays: it is what the availability engine, the edge
                function and the public page all read. */}
            <div style={label}>How far ahead can guests book?</div>
            <Stepper
              value={windowMonthsLabel(cfg.online?.windowDays ?? 90)}
              onDown={() => edit((next) => {
                next.config.online.windowDays = shiftWindowMonths(next.config.online.windowDays ?? 90, -1);
              })}
              onUp={() => edit((next) => {
                next.config.online.windowDays = shiftWindowMonths(next.config.online.windowDays ?? 90, 1);
              })}
            />
          </div>
        </div>
        <div style={explain}>
          A guest can book online until {cfg.online?.leadMinutes ?? 30} minutes before a seating.
          The book rolls open to {windowEndLabel(cfg.online?.windowDays ?? 90)} ({cfg.online?.windowDays ?? 90} days);
          past that the page says booking is not open yet.
        </div>

        {/* Months decided by hand. This is how a restaurant actually talks
            about the book — "December is on sale", "we are shut in January" —
            and neither of those is a number of days. A month left on ROLLING
            follows the window above, so forgetting to touch this screen can
            never close the book by accident. */}
        <div style={{ ...card, marginTop: 12 }}>
          <div style={label}>Open or close a month</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 6 }}>
            {upcomingMonths(cfg.online?.windowDays ?? 90).map(({ key, title, rolling }) => {
              const decided = cfg.online?.months?.[key];
              const set = (value) => edit((next) => {
                const months = { ...(next.config.online.months || {}) };
                if (value === null) delete months[key];
                else months[key] = value;
                next.config.online.months = months;
              });
              const state = decided === true ? "open" : decided === false ? "closed" : "rolling";
              return (
                <div key={key} style={{ border: `1px solid ${tokens.ink[4]}`, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.08em", color: tokens.ink[0], marginBottom: 6 }}>
                    {title}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" style={toggleBtn(state === "rolling")} onClick={() => set(null)}>
                      Rolling{rolling ? "" : " (shut)"}
                    </button>
                    <button type="button" style={toggleBtn(state === "open")} onClick={() => set(true)}>Open</button>
                    <button type="button" style={toggleBtn(state === "closed")} onClick={() => set(false)}>Closed</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={explain}>
            ROLLING follows the window above. OPEN puts a month on sale even if the
            window has not reached it yet — how December goes live in September.
            CLOSED shuts a month inside the window, for the annual closure.
          </div>
        </div>
      </div>
    </>
  );
}

function CalendarClosures({ rules, edit, scratch, setScratch, canEdit, setMessage }) {
  const addRule = (kind, extra) => {
    const date = scratch.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMessage("Enter the date as 2026-07-28.");
      return;
    }
    edit((next) => {
      next.exceptions = next.exceptions.filter((rule) => !(rule.date === date && rule.kind === kind));
      next.exceptions.push({ date, kind, ...extra });
    });
    setScratch({ ...scratch, date: "", label: "", capacity: "" });
  };

  return (
    <>
      <div style={sectionHeader}>Calendar &amp; closures</div>

      <div style={card}>
        <div style={label}>Close a date · add a private event · cap a day</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* A real date picker. Typing 2026-07-28 by hand is a spelling test
              nobody should sit, and the failure mode was a refused save. */}
          <input type="date" value={scratch.date} onChange={(event) => setScratch({ ...scratch, date: event.target.value })} style={{ ...baseInp, width: 160 }} />
          <input value={scratch.label} onChange={(event) => setScratch({ ...scratch, label: event.target.value })} placeholder="Reason / event name" style={{ ...baseInp, width: 180 }} />
          <input value={scratch.capacity} onChange={(event) => setScratch({ ...scratch, capacity: event.target.value })} placeholder="Cap" style={{ ...baseInp, width: 60, textAlign: "center" }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" disabled={!canEdit} style={dangerBtn} onClick={() => addRule("closed", { label: scratch.label.trim() || "closed" })}>
            Close the date
          </button>
          <button type="button" disabled={!canEdit} style={saveBtn("idle")} onClick={() => addRule("private_event", { label: scratch.label.trim() || "private event" })}>
            Private event
          </button>
          <button
            type="button"
            disabled={!canEdit}
            style={saveBtn("idle")}
            onClick={() => {
              const capacity = Number.parseInt(scratch.capacity, 10);
              if (!Number.isFinite(capacity)) {
                setMessage("Enter the number of covers to cap the day at.");
                return;
              }
              addRule("capacity_override", { capacity });
            }}
          >
            Cap the day
          </button>
        </div>
        <div style={explain}>
          A closure or private event removes the date everywhere — the Day Book, the Calendar and the guest page. A cap limits covers without closing.
        </div>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={label}>Exceptions on the calendar</div>
        {!rules.length && <div style={{ fontSize: 10, color: tokens.ink[3], marginTop: 10 }}>No closures, private events or overrides yet.</div>}
        {[...rules]
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map((rule, index) => (
            <div key={`${rule.date}-${rule.kind}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "8px 0" }}>
              <span style={{ fontSize: 10, color: tokens.ink[1] }}>
                {rule.date} · {String(rule.kind).replace("_", " ")}
                {rule.service ? ` · ${rule.service}` : ""}
                {rule.label ? ` · ${rule.label}` : ""}
                {rule.capacity != null ? ` · ${rule.capacity} covers` : ""}
              </span>
              <button
                type="button"
                disabled={!canEdit}
                style={saveBtn("idle")}
                onClick={() => edit((next) => { next.exceptions = next.exceptions.filter((item) => item !== next.exceptions[index]); })}
              >
                Remove
              </button>
            </div>
          ))}
      </div>
    </>
  );
}

function Capacity({ cfg, edit }) {
  return (
    <>
      <div style={sectionHeader}>Availability &amp; capacity</div>

      <div style={card}>
        <div style={label}>How many guests can arrive at the same time?</div>
        <Stepper
          value={`${cfg.pacing?.coversPerSlot ?? 12} covers`}
          onDown={() => edit((next) => { next.config.pacing.coversPerSlot = Math.max(2, next.config.pacing.coversPerSlot - 1); })}
          onUp={() => edit((next) => { next.config.pacing.coversPerSlot = Math.min(60, next.config.pacing.coversPerSlot + 1); })}
        />
        <div style={explain}>The kitchen sends one set of first courses per seating — this caps covers booked into a single seating time, in-house and online alike.</div>

        <div style={{ ...label, marginTop: 16 }}>How many guests in a whole service?</div>
        <Stepper
          value={`${cfg.pacing?.coversPerService ?? 44} covers`}
          onDown={() => edit((next) => { next.config.pacing.coversPerService = Math.max(4, next.config.pacing.coversPerService - 2); })}
          onUp={() => edit((next) => { next.config.pacing.coversPerService = Math.min(300, next.config.pacing.coversPerService + 2); })}
        />
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ ...label, marginBottom: 10 }}>How long should we keep each table?</div>
        {[
          ["small", "Up to 2 guests"],
          ["medium", "3 to 6 guests"],
          ["large", "7 or more"],
          ["buffer", "Reset time between parties"],
        ].map(([key, text]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px solid ${tokens.neutral[100]}` }}>
            <span style={{ fontSize: 11, color: tokens.ink[1] }}>{text}</span>
            <Stepper
              size={30}
              width={74}
              value={`${cfg.durations?.[key] ?? 0} min`}
              onDown={() => edit((next) => { next.config.durations[key] = Math.max(key === "buffer" ? 0 : 60, next.config.durations[key] - 15); })}
              onUp={() => edit((next) => { next.config.durations[key] = Math.min(key === "buffer" ? 45 : 240, next.config.durations[key] + 15); })}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function Tables({ cfg, edit, scratch, setScratch, setMessage, floorMaps, enableImport }) {
  const tables = cfg.tables || [];
  return (
    <>
      <div style={sectionHeader}>Tables — reservation inventory</div>
      {enableImport && <ImportFromDiningRoom cfg={cfg} edit={edit} floorMaps={floorMaps} />}
      <div style={card}>
        <div style={explain}>A reservation-only copy of the dining room. Changing it never touches the live Service board or the floor plan.</div>
        {tables.map((table, index) => (
          <div key={table.id} style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "7px 0", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, minWidth: 48, color: tokens.ink[0] }}>{table.id}</span>
            <Stepper
              size={26}
              width={64}
              value={`${table.seats} seats`}
              onDown={() => edit((next) => { next.config.tables[index].seats = Math.max(1, next.config.tables[index].seats - 1); })}
              onUp={() => edit((next) => { next.config.tables[index].seats = Math.min(14, next.config.tables[index].seats + 1); })}
            />
            <button type="button" style={dangerBtn} onClick={() => edit((next) => { next.config.tables.splice(index, 1); })}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          style={{ ...saveBtn("idle"), marginTop: 10, borderStyle: "dashed" }}
          onClick={() =>
            edit((next) => {
              const nextNumber = next.config.tables.length + 1;
              next.config.tables.push({ id: `T${String(nextNumber).padStart(2, "0")}`, seats: 2 });
            })
          }
        >
          + Add a table
        </button>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ ...label, marginBottom: 8 }}>Which tables can be joined together?</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {(cfg.combos || []).map((combo, index) => (
            <button key={combo.join("-")} type="button" title="Tap to remove" style={toggleBtn(true)} onClick={() => edit((next) => { next.config.combos.splice(index, 1); })}>
              {combo.join(" + ")} ×
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <input value={scratch.comboA} onChange={(event) => setScratch({ ...scratch, comboA: event.target.value })} placeholder="T01" style={{ ...baseInp, width: 70, textAlign: "center" }} />
          <span style={{ fontSize: 10, color: tokens.ink[3] }}>+</span>
          <input value={scratch.comboB} onChange={(event) => setScratch({ ...scratch, comboB: event.target.value })} placeholder="T02" style={{ ...baseInp, width: 70, textAlign: "center" }} />
          <button
            type="button"
            style={saveBtn("idle")}
            onClick={() => {
              const a = scratch.comboA.trim().toUpperCase();
              const b = scratch.comboB.trim().toUpperCase();
              const known = (id) => tables.some((table) => String(table.id).toUpperCase() === id);
              if (!known(a) || !known(b) || a === b) {
                setMessage("Pick two different tables that exist.");
                return;
              }
              edit((next) => { next.config.combos.push([a, b]); });
              setScratch({ ...scratch, comboA: "", comboB: "" });
            }}
          >
            Allow this pair
          </button>
        </div>
        <div style={explain}>Joined pairs let a bigger party book two tables as one — the suggestion engine uses them automatically.</div>
      </div>
    </>
  );
}

/**
 * Loop 3 — take the current dining room.
 *
 * A copy, taken when somebody asks for it, shown in full before it is applied.
 * The live floor plan is never written, and availability never depends on it:
 * everything the engine uses lives in the reservation config from here on.
 */
function ImportFromDiningRoom({ cfg, edit, floorMaps }) {
  const [preview, setPreview] = useState(null);
  const map = activeDiningMap(floorMaps);

  if (!map) {
    return (
      <div style={card}>
        <div style={label}>Take the current dining room</div>
        <div style={explain}>No dining room layout is available to read. Draw one in Floor first.</div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={label}>Take the current dining room</div>
      <div style={explain}>
        Reads the floor plan ({map.name || map.id}) and copies it into the reservation table list. The floor plan itself is
        never changed, and bookings never read it again — this is a copy you can edit afterwards.
      </div>

      {!preview && (
        <button type="button" style={{ ...saveBtn("idle"), marginTop: 10 }} onClick={() => setPreview(tablesFromDiningMap(map, cfg))}>
          See what would change
        </button>
      )}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: tokens.ink[1], lineHeight: 1.8 }}>
            {preview.tables.length} bookable {preview.tables.length === 1 ? "table" : "tables"} ·{" "}
            {preview.tables.reduce((total, table) => total + Number(table.seats), 0)} seats ·{" "}
            {preview.combos.length} joinable {preview.combos.length === 1 ? "pair" : "pairs"}
          </div>

          {preview.changes.length === 0 && (
            <div style={explain}>Nothing would change — the reservation list already matches the room.</div>
          )}

          {preview.changes.map((change) => (
            <div key={change.label} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", borderTop: `1px solid ${tokens.neutral[100]}`, padding: "6px 0" }}>
              <span style={{ fontSize: 10, color: tokens.ink[1], flex: "1 1 200px" }}>{change.label}</span>
              <span style={{ fontSize: 9, color: tokens.ink[3] }}>{change.from} → </span>
              <span style={{ fontSize: 10, color: tokens.ink[0], fontWeight: 600 }}>{change.to}</span>
              {change.warning && <span style={{ fontSize: 9, color: tokens.signal.warn, flexBasis: "100%" }}>{change.warning}</span>}
            </div>
          ))}

          {preview.skipped.length > 0 && (
            <div style={explain}>
              Not imported: {preview.skipped.map((item) => `${item.label} (${item.reason})`).join(", ")}. Nothing on the floor
              plan was altered — add these by hand if they should be bookable.
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={saveBtn("idle")}
              onClick={() => {
                edit((next) => {
                  next.config.tables = preview.tables.map((table) => ({ ...table }));
                  next.config.combos = preview.combos.map((pair) => [...pair]);
                });
                setPreview(null);
              }}
            >
              Take this room
            </button>
            <button type="button" style={dangerBtn} onClick={() => setPreview(null)}>
              Leave it as it is
            </button>
          </div>
          <div style={explain}>
            Taking the room only fills in the draft — nothing is saved until you review and save at the bottom of the page,
            like every other setting here.
          </div>
        </div>
      )}
    </div>
  );
}

function BookingRules({ cfg, edit }) {
  return (
    <>
      <div style={sectionHeader}>Booking rules</div>

      <div style={card}>
        <div style={label}>Automatically confirm parties up to…</div>
        <Stepper
          value={`${cfg.online?.autoConfirmMaxPax ?? 4} guests`}
          onDown={() => edit((next) => { next.config.online.autoConfirmMaxPax = Math.max(0, next.config.online.autoConfirmMaxPax - 1); })}
          onUp={() => edit((next) => { next.config.online.autoConfirmMaxPax = Math.min(20, next.config.online.autoConfirmMaxPax + 1); })}
        />
        <div style={explain}>
          {(cfg.online?.autoConfirmMaxPax ?? 4) === 0
            ? "Every online booking waits as pending until staff confirm it."
            : `Parties up to ${cfg.online.autoConfirmMaxPax} are confirmed instantly; larger requests arrive as pending for a personal look before the evening is promised.`}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={label}>Largest party bookable online</div>
            <Stepper
              value={`${cfg.online?.maxPax ?? 6} guests`}
              onDown={() => edit((next) => { next.config.online.maxPax = Math.max(1, next.config.online.maxPax - 1); })}
              onUp={() => edit((next) => { next.config.online.maxPax = Math.min(30, next.config.online.maxPax + 1); })}
            />
          </div>
          <div>
            <div style={label}>When no table is available</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[["waitlist", "Offer the waitlist"], ["phone", "Show our phone number"]].map(([value, text]) => (
                <button key={value} type="button" style={toggleBtn(cfg.online?.whenFull === value)} onClick={() => edit((next) => { next.config.online.whenFull = value; })}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ ...label, marginBottom: 8 }}>Walk-ins</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={toggleBtn(cfg.walkIns?.enabled !== false)} onClick={() => edit((next) => { next.config.walkIns.enabled = !(next.config.walkIns?.enabled !== false); })}>
            {cfg.walkIns?.enabled !== false ? "Staff may take walk-ins" : "No walk-ins"}
          </button>
          <Stepper
            size={30}
            width={74}
            value={`${cfg.walkIns?.holdMinutes ?? 15} min`}
            onDown={() => edit((next) => { next.config.walkIns.holdMinutes = Math.max(0, (next.config.walkIns.holdMinutes ?? 15) - 5); })}
            onUp={() => edit((next) => { next.config.walkIns.holdMinutes = Math.min(60, (next.config.walkIns.holdMinutes ?? 15) + 5); })}
          />
        </div>
        <div style={explain}>Walk-ins are a staff action only — the guest page never offers them.</div>
      </div>
    </>
  );
}

// A config that has never been saved carries no experiences key, and the guest
// page falls back to the defaults through normalizeReservationConfig. Reading
// the raw value here showed the manager an empty screen while /book was busy
// offering two menus — the same setting, two different answers. Show what the
// guest sees, and write it down the first time it is touched.
const experienceList = (cfg) => (
  Array.isArray(cfg.experiences) ? cfg.experiences : normalizeReservationConfig(cfg).experiences
);
const materialize = (next) => {
  if (!Array.isArray(next.config.experiences)) {
    next.config.experiences = experienceList(next.config).map((item) => ({ ...item }));
  }
  return next.config.experiences;
};

function Experiences({ cfg, edit }) {
  const shown = experienceList(cfg);
  return (
    <>
      <div style={sectionHeader}>Experiences</div>
      {shown.map((experience, index) => (
        <div key={experience.key} style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <input
              value={experience.title}
              onChange={(event) => edit((next) => { materialize(next)[index].title = event.target.value; })}
              style={{ ...baseInp, fontSize: 13, fontWeight: 600, minWidth: 220 }}
            />
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {SERVICES.map((service) => {
                const on = (experience.services || []).includes(service);
                return (
                  <button
                    key={service}
                    type="button"
                    style={toggleBtn(on)}
                    onClick={() =>
                      edit((next) => {
                        const item = materialize(next)[index];
                        item.services = on ? item.services.filter((value) => value !== service) : [...(item.services || []), service];
                      })
                    }
                  >
                    {service}
                  </button>
                );
              })}
              <button type="button" style={toggleBtn(experience.active !== false)} onClick={() => edit((next) => { const item = materialize(next)[index]; item.active = !(item.active !== false); })}>
                {experience.active !== false ? "Offered" : "Hidden"}
              </button>
            </div>
          </div>
          <textarea
            value={experience.description || ""}
            onChange={(event) => edit((next) => { materialize(next)[index].description = event.target.value; })}
            style={{ ...baseInp, width: "100%", boxSizing: "border-box", minHeight: 44, resize: "vertical", lineHeight: 1.6, marginTop: 8 }}
          />
          <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.6, marginTop: 6 }}>
            {experience.menuType
              ? `Serves the ${experience.menuType} menu — the one Menu Layout builds and the kitchen ticket prints. Choosing this sets the booking's menu.`
              : "Wording only: this experience commits the kitchen to no particular menu."}
            {" "}Offered on {(experience.services || []).length ? experience.services.join(" and ") : "no service — guests cannot pick it"}.
          </div>
          <div style={{ fontSize: 9, color: tokens.signal.warn, lineHeight: 1.6, marginTop: 6 }}>
            Deposits need a payment provider — not configured, so this experience takes no deposit.
          </div>
        </div>
      ))}
      {/* The two menus, offered as one tap when they are missing. A LAB or a
          new restaurant starts with no experiences saved, and "+ Add an
          experience" gave a blank card that meant nothing to the kitchen. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MENU_EXPERIENCES.filter(({ key }) => !shown.some((item) => item.key === key))
          .map(({ key, menuType, title, description }) => (
            <button
              key={key}
              type="button"
              style={{ ...saveBtn("idle"), borderStyle: "dashed" }}
              onClick={() => edit((next) => {
                // `edit` clones the SAVED config, which need not carry the key
                // at all — pushing onto undefined is what made this button do
                // nothing at all on a fresh workspace.
                next.config.experiences = [...materialize(next), {
                  key, menuType, title, description, services: ["lunch", "dinner"], active: true, deposit: "none",
                }];
              })}
            >
              + {title}
            </button>
          ))}
        <button
          type="button"
          style={{ ...saveBtn("idle"), borderStyle: "dashed" }}
          onClick={() => edit((next) => {
            const list = materialize(next);
            next.config.experiences = [...list, {
              key: `exp_${list.length + 1}`,
              title: "New experience",
              description: "Describe it for guests.",
              services: ["dinner"],
              active: false,
              deposit: "none",
            }];
          })}
        >
          + Another experience
        </button>
      </div>
    </>
  );
}

function PublicPage({ cfg, edit }) {
  const page = cfg.publicPage || {};
  return (
    <>
      <div style={sectionHeader}>Public booking page</div>
      <div style={card}>
        <div style={label}>Restaurant name</div>
        <input value={cfg.restaurantName || ""} onChange={(event) => edit((next) => { next.config.restaurantName = event.target.value; })} style={{ ...baseInp, width: "100%", boxSizing: "border-box" }} />

        <div style={{ ...label, marginTop: 10 }}>Welcome line</div>
        <textarea value={cfg.tagline || ""} onChange={(event) => edit((next) => { next.config.tagline = event.target.value; })} style={{ ...baseInp, width: "100%", boxSizing: "border-box", minHeight: 44, resize: "vertical", lineHeight: 1.6 }} />

        <div style={{ ...label, marginTop: 10 }}>Telephone</div>
        <input value={page.phone || ""} onChange={(event) => edit((next) => { next.config.publicPage.phone = event.target.value; })} style={{ ...baseInp, width: "100%", boxSizing: "border-box" }} />

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
          <div>
            <div style={label}>Languages</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[["en", "English"], ["sl", "Slovenščina"]].map(([code, text]) => {
                const on = (page.languages || []).includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    style={toggleBtn(on)}
                    onClick={() =>
                      edit((next) => {
                        const languages = next.config.publicPage.languages || [];
                        next.config.publicPage.languages = on ? languages.filter((value) => value !== code) : [...languages, code];
                      })
                    }
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={label}>Required from guests</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[["requireEmail", "Email"], ["requirePhone", "Telephone"]].map(([key, text]) => (
                <button key={key} type="button" style={toggleBtn(page[key] !== false)} onClick={() => edit((next) => { next.config.publicPage[key] = !(next.config.publicPage[key] !== false); })}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={label}>Conditions shown before confirming</div>
        <textarea
          value={Array.isArray(page.policies) ? page.policies.join("\n") : page.policies || ""}
          onChange={(event) => edit((next) => { next.config.publicPage.policies = event.target.value; })}
          style={{ ...baseInp, width: "100%", boxSizing: "border-box", minHeight: 90, resize: "vertical", lineHeight: 1.7 }}
        />
        <div style={explain}>One condition per line. Guests must accept these before a reservation is created.</div>
      </div>
    </>
  );
}

function Messages({ cfg, edit }) {
  const messages = cfg.messages || {};
  return (
    <>
      <div style={sectionHeader}>Guest messages</div>
      <div style={{ border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0], padding: "10px 12px", marginBottom: 12, fontSize: 9, color: tokens.ink[2], lineHeight: 1.7 }}>
        Sending is not configured — these are the exact drafts the system will use once a provider is connected. Placeholders:{" "}
        <b>{"{name} {date} {time} {pax} {ref}"}</b>
      </div>
      {[
        ["confirm", "Booking confirmation"],
        ["reminder", "Reminder"],
        ["modified", "Modification"],
        ["cancelled", "Cancellation"],
        ["waitlist", "Waitlist opening"],
      ].map(([key, title]) => (
        <div key={key} style={card}>
          <div style={{ fontSize: 10, fontWeight: 600, color: tokens.ink[0], marginBottom: 8 }}>{title}</div>
          {["en", "sl"].map((lang) => (
            <div key={lang}>
              <div style={{ fontSize: 8, letterSpacing: 1, color: tokens.ink[3], margin: "8px 0 4px", textTransform: "uppercase" }}>
                {lang === "en" ? "English" : "Slovenščina"}
              </div>
              <textarea
                value={messages[key]?.[lang] || ""}
                onChange={(event) => edit((next) => { next.config.messages[key][lang] = event.target.value; })}
                style={{ ...baseInp, width: "100%", boxSizing: "border-box", minHeight: 44, resize: "vertical", lineHeight: 1.6, fontSize: 10 }}
              />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function WaitlistSettings({ cfg, edit }) {
  const waitlist = cfg.waitlist || {};
  return (
    <>
      <div style={sectionHeader}>Waitlist</div>
      <div style={{ ...card, marginBottom: 0 }}>
        <button type="button" style={toggleBtn(waitlist.enabled !== false)} onClick={() => edit((next) => { next.config.waitlist.enabled = !(next.config.waitlist.enabled !== false); })}>
          {waitlist.enabled !== false ? "Waitlist is open" : "Waitlist is closed"}
        </button>

        <div style={{ ...label, marginTop: 16 }}>Wait we quote by default</div>
        <Stepper
          value={`${waitlist.defaultQuoteMinutes ?? 30} min`}
          onDown={() => edit((next) => { next.config.waitlist.defaultQuoteMinutes = Math.max(5, (next.config.waitlist.defaultQuoteMinutes ?? 30) - 5); })}
          onUp={() => edit((next) => { next.config.waitlist.defaultQuoteMinutes = Math.min(180, (next.config.waitlist.defaultQuoteMinutes ?? 30) + 5); })}
        />

        <div style={{ marginTop: 14 }}>
          <button type="button" style={toggleBtn(Boolean(waitlist.autoSuggest))} onClick={() => edit((next) => { next.config.waitlist.autoSuggest = !next.config.waitlist.autoSuggest; })}>
            {waitlist.autoSuggest ? "Suggest matches automatically" : "No automatic suggestions"}
          </button>
        </div>
        <div style={explain}>
          When a cancellation opens a table, matching parties surface in the Day Book — staff always confirm before anyone is called. Nothing is sent automatically.
        </div>
      </div>
    </>
  );
}

function Privacy({ cfg, edit }) {
  return (
    <>
      <div style={sectionHeader}>Guests &amp; privacy</div>
      <div style={{ ...card, marginBottom: 0 }}>
        <div style={label}>How long do we keep guest history?</div>
        <Stepper
          value={`${cfg.privacy?.retentionMonths ?? 24} months`}
          onDown={() => edit((next) => { next.config.privacy.retentionMonths = Math.max(6, next.config.privacy.retentionMonths - 6); })}
          onUp={() => edit((next) => { next.config.privacy.retentionMonths = Math.min(120, next.config.privacy.retentionMonths + 6); })}
        />
        <div style={explain}>
          Older visits are anonymised once the retention job runs — the rule is stored here so the restaurant decides it, not the developers.
        </div>
      </div>
    </>
  );
}

function Team({ cfg, edit, scratch, setScratch }) {
  return (
    <>
      <div style={sectionHeader}>Permissions</div>
      <div style={card}>
        {(cfg.team || []).map((member, index) => (
          <div key={`${member.name}-${index}`} style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "8px 0", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: tokens.ink[0], minWidth: 120 }}>{member.name}</span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {RESERVATION_ROLES.map((role) => (
                <button key={role} type="button" style={toggleBtn(member.role === role)} onClick={() => edit((next) => { next.config.team[index].role = role; })}>
                  {role}
                </button>
              ))}
            </span>
            <button type="button" style={dangerBtn} onClick={() => edit((next) => { next.config.team.splice(index, 1); })}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <input value={scratch.member} onChange={(event) => setScratch({ ...scratch, member: event.target.value })} placeholder="Name…" style={{ ...baseInp, width: 180 }} />
          <button
            type="button"
            style={saveBtn("idle")}
            onClick={() => {
              const name = scratch.member.trim();
              if (!name) return;
              edit((next) => { next.config.team.push({ name, role: "host" }); });
              setScratch({ ...scratch, member: "" });
            }}
          >
            + Add person
          </button>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 0, fontSize: 9, color: tokens.ink[2], lineHeight: 2 }}>
        <div>Admin — everything, including these settings.</div>
        <div>Manager — bookings, waitlist, overrides and pacing exceptions; not settings.</div>
        <div>Host — take and edit bookings and the waitlist; no cancellations without a reason, no settings.</div>
        <div>Read-only — sees the Day Book, Timeline and Calendar; changes nothing.</div>
        <div style={{ color: tokens.ink[3] }}>Enforced by the existing Admin authorization — no second login.</div>
      </div>
    </>
  );
}

function AuditLog({ audit }) {
  return (
    <>
      <div style={sectionHeader}>Audit log — reservation settings</div>
      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.7, marginBottom: 10 }}>
          Every saved settings change: who, when, and what moved. Day-to-day booking actions live on each reservation's own history instead, so this list stays readable.
        </div>
        {!audit.length && <div style={{ fontSize: 10, color: tokens.ink[3] }}>No administrative changes recorded yet.</div>}
        {audit.map((entry, index) => (
          <div key={index} style={{ fontSize: 9, color: tokens.ink[1], borderBottom: `1px solid ${tokens.neutral[100]}`, padding: "7px 0", lineHeight: 1.6 }}>
            {(entry.at || entry.createdAt || "").toString().slice(0, 16).replace("T", " ")} · {entry.actor || entry.by || "—"} · {entry.section || entry.label || "—"} ·{" "}
            {String(entry.from ?? "—")} → {String(entry.to ?? "—")}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── diff + impact ───────────────────────────────────────────────────────── */

const UPCOMING = new Set(["pending", "confirmed", "arrived"]);
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * The "what will change?" summary.
 *
 * Warnings are computed from the same bookings the availability engine reads,
 * so the panel can never promise something the booking API would refuse — and
 * a manager is told, before saving, how many real reservations a change lands on.
 */
function computeChanges(applied, draft, bookings) {
  const rows = [];
  const push = (label, from, to, warning) => rows.push({ label, from: String(from), to: String(to), warning: warning || "" });
  const json = (value) => JSON.stringify(value);
  const upcoming = (bookings || []).filter((booking) => booking.date >= todayISO() && UPCOMING.has(booking.status));

  const a = applied.config;
  const d = draft.config;

  for (const [path, title] of [
    ["online.autoConfirmMaxPax", "Auto-confirm parties up to"],
    ["online.maxPax", "Largest online party"],
    ["online.leadMinutes", "Booking lead time"],
    ["online.windowDays", "Booking window"],
    ["online.months", "Months open or closed"],
    ["online.whenFull", "When fully booked"],
    ["pacing.coversPerSlot", "Guests per seating"],
    ["pacing.coversPerService", "Guests per service"],
    ["durations.small", "Table time — up to 2"],
    ["durations.medium", "Table time — 3 to 6"],
    ["durations.large", "Table time — 7 or more"],
    ["durations.buffer", "Reset time between parties"],
    ["privacy.retentionMonths", "Guest data retention"],
    ["waitlist.defaultQuoteMinutes", "Default quoted wait"],
    ["restaurantName", "Restaurant name"],
    ["tagline", "Welcome line"],
  ]) {
    const before = path.split(".").reduce((value, key) => value?.[key], a);
    const after = path.split(".").reduce((value, key) => value?.[key], d);
    if (before === after) continue;
    let warning = "";
    if (path === "pacing.coversPerSlot") {
      const busiest = busiestSeating(upcoming);
      if (busiest.covers > after) {
        warning = `The busiest seating already booked (${busiest.key}) holds ${busiest.covers} covers, above the new cap. Existing bookings stay; new ones are blocked.`;
      }
    }
    if (path === "online.autoConfirmMaxPax" && after === 0) {
      warning = "Every online booking will wait as pending until staff confirm it.";
    }
    push(title, before ?? "—", after ?? "—", warning);
  }

  // Weekly schedule — the change a restaurant most needs spelled out.
  const dayKey = (row) => `${row.service}|${row.weekday}`;
  const beforeDays = new Map(applied.weeklyServices.map((row) => [dayKey(row), row]));
  const afterDays = new Map(draft.weeklyServices.map((row) => [dayKey(row), row]));
  const removed = [];
  const added = [];
  const retimed = [];
  new Set([...beforeDays.keys(), ...afterDays.keys()]).forEach((key) => {
    const before = beforeDays.get(key);
    const after = afterDays.get(key);
    const wasOn = Boolean(before?.enabled);
    const isOn = Boolean(after?.enabled);
    const [service, weekday] = key.split("|");
    if (wasOn && !isOn) removed.push({ service, weekday: Number(weekday) });
    else if (!wasOn && isOn) added.push({ service, weekday: Number(weekday) });
    else if (isOn && (before.first !== after.first || before.last !== after.last || before.interval !== after.interval)) {
      retimed.push({ service, weekday: Number(weekday), before, after });
    }
  });

  removed.forEach(({ service, weekday }) => {
    const hits = upcoming.filter((booking) => booking.service === service && dateWeekday(booking.date) === weekday);
    push(
      `${service} on ${DAY_LONG[weekday]}`,
      "served",
      "not served",
      hits.length
        ? `${hits.length} existing reservation${hits.length > 1 ? "s" : ""} on affected dates stay booked and need a personal call.`
        : "No existing reservations are affected.",
    );
  });
  added.forEach(({ service, weekday }) => push(`${service} on ${DAY_LONG[weekday]}`, "not served", "served"));
  retimed.forEach(({ service, weekday, before, after }) =>
    push(`${service} hours on ${DAY_LONG[weekday]}`, `${before.first}–${before.last}`, `${after.first}–${after.last}`),
  );

  if (json(applied.exceptions) !== json(draft.exceptions)) {
    const addedRules = draft.exceptions.filter(
      (rule) => !applied.exceptions.some((existing) => existing.date === rule.date && existing.kind === rule.kind),
    );
    const blocking = addedRules.filter((rule) => rule.kind === "closed" || rule.kind === "private_event");
    const hits = upcoming.filter((booking) => blocking.some((rule) => rule.date === booking.date));
    push(
      "Calendar exceptions",
      `${applied.exceptions.length} rule${applied.exceptions.length === 1 ? "" : "s"}`,
      `${draft.exceptions.length} rule${draft.exceptions.length === 1 ? "" : "s"}`,
      hits.length ? `${hits.length} existing reservation${hits.length > 1 ? "s" : ""} fall on a newly closed date — they remain and need a personal call.` : "",
    );
  }

  if (json(a.tables) !== json(d.tables)) {
    const gone = (a.tables || []).filter((table) => !(d.tables || []).some((next) => next.id === table.id)).map((table) => table.id);
    const hits = upcoming.filter((booking) => {
      const held = booking.operationalData?.tableGroup || (booking.tableLabel ? [booking.tableLabel] : []);
      return gone.some((id) => held.map(String).includes(String(id)));
    });
    push(
      "Bookable tables",
      `${(a.tables || []).length} tables`,
      `${(d.tables || []).length} tables`,
      hits.length ? `${gone.join(", ")} hold ${hits.length} upcoming reservation${hits.length > 1 ? "s" : ""} — move them in the Day Book first.` : "",
    );
  }

  if (json(a.combos) !== json(d.combos)) {
    push("Joinable tables", (a.combos || []).map((combo) => combo.join("+")).join(", ") || "none", (d.combos || []).map((combo) => combo.join("+")).join(", ") || "none");
  }
  if (json(a.experiences) !== json(d.experiences)) {
    const names = (list) => (list || []).filter((item) => item.active !== false).map((item) => item.title).join(", ") || "none";
    push("Experiences offered", names(a.experiences), names(d.experiences));
  }
  if (json(a.publicPage) !== json(d.publicPage)) push("Public booking page", "current text and fields", "updated text and fields");
  if (json(a.messages) !== json(d.messages)) push("Guest messages", "current templates", "updated templates");
  if (json(a.team) !== json(d.team)) push("Team access", `${(a.team || []).length} people`, `${(d.team || []).length} people`);
  if (json(a.walkIns) !== json(d.walkIns)) {
    push("Walk-ins", a.walkIns?.enabled === false ? "not taken" : "taken by staff", d.walkIns?.enabled === false ? "not taken" : "taken by staff");
  }

  return rows;
}

function busiestSeating(bookings) {
  const totals = new Map();
  bookings.forEach((booking) => {
    const key = `${booking.date} ${booking.time}`;
    totals.set(key, (totals.get(key) || 0) + Number(booking.pax || 0));
  });
  let best = { key: "—", covers: 0 };
  totals.forEach((covers, key) => {
    if (covers > best.covers) best = { key, covers };
  });
  return best;
}
