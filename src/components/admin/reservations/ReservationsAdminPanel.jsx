// Reservations Admin — a module INSIDE the existing Milka Admin shell.
//
// CANONICAL SOURCE: reservation_bookings. Impact warnings are computed from
// bookings in the booking UI model; the legacy `reservations` shape is never read
// here.
//
// Boundary: this panel reads and writes
// reservation-owned configuration only. It never touches service_tables,
// service_settings, floor maps, courses, the live service clock or any
// live-Service mutation. Authorization is the Admin shell's own — no second PIN.
//
// Every style here comes from the existing admin primitives (adminStyles.js,
// styles/mixins.js, styles/tokens.js) so the module inherits Admin's grammar
// instead of introducing a competing one.
//
// Impact warnings are computed with the SAME domain functions the server uses
// (domain/reservations/availability.js), so "this removes 3 bookable times"
// can never disagree with what the booking API will actually do.

import React, { useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens.js";
import { chip, circleButton, modalContent, modalOverlay } from "../../../styles/mixins.js";
import {
  FONT, baseInp, fieldLabel, sectionHeader,
  panelBtn, primaryBtn, saveBtn, dangerBtn, toggleBtn,
} from "../adminStyles.js";
import {
  DEFAULT_WEEKLY_SERVICES,
  durationForParty,
  normalizeReservationConfig,
} from "../../../domain/reservations/config.js";
import {
  dateWeekday, generateSlots, minutesOf, resolveServicesForDate,
} from "../../../domain/reservations/availability.js";

const SECTIONS = [
  ["overview", "Overview", "start here"],
  ["hours", "Services & Hours", "which days, which times"],
  ["calendar", "Calendar & Closures", "days off, private events"],
  ["capacity", "Availability & Capacity", "pacing, table time"],
  ["tables", "Tables", "seats, sections, joins"],
  ["rules", "Booking Rules", "confirm, cancel, no-show"],
  ["experiences", "Experiences", "menus guests choose"],
  ["public", "Public Booking Page", "what guests see"],
  ["messages", "Guest Messages", "confirmation, reminder"],
  ["waitlist", "Waitlist", "quotes, matching"],
  ["privacy", "Guests & Privacy", "retention, export"],
  ["permissions", "Permissions", "who can change what"],
  ["audit", "Audit Log", "every change, recorded"],
];

const WEEKDAYS = [
  [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [0, "Sunday"],
];
const SERVICE_NAMES = ["lunch", "dinner"];

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "arrived"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
// A calendar rule is identified by (date, kind, service) — the same key the
// table is unique on — so a lunch override never stands in for a dinner one.
const sameException = (a, b) => a.date === b.date && a.kind === b.kind && (a.service ?? null) === (b.service ?? null);
const hours = (minutes) => `${Math.round((minutes / 60) * 10) / 10} h`;

// ── small shared bits, all built from the admin primitives ──────────────────

function Row({ label, hint, children }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
      <div style={{ ...fieldLabel, marginBottom: 6 }}>{label}</div>
      {children}
      {hint ? (
        <div style={{ fontFamily: FONT, fontSize: 10, lineHeight: 1.7, color: tokens.ink[3], marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 999, step = 1, format }) {
  const set = (next) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" style={circleButton} onClick={() => set(Number(value) - step)} aria-label="Less">−</button>
      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, minWidth: 96, textAlign: "center", color: tokens.ink[0] }}>
        {format ? format(value) : value}
      </span>
      <button type="button" style={circleButton} onClick={() => set(Number(value) + step)} aria-label="More">+</button>
    </div>
  );
}

function Choice({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([key, label, disabled, title]) => (
        <button
          key={key}
          type="button"
          title={title || ""}
          disabled={Boolean(disabled)}
          onClick={() => !disabled && onChange(key)}
          style={{ ...panelBtn(value === key), opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TimeStepper({ value, onChange, interval = 15 }) {
  const shift = (delta) => {
    const next = Math.max(0, Math.min(23 * 60 + 45, minutesOf(value) + delta));
    onChange(`${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" style={{ ...circleButton, width: 34, height: 34, fontSize: 15 }} onClick={() => shift(-interval)}>−</button>
      <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, minWidth: 52, textAlign: "center" }}>{value}</span>
      <button type="button" style={{ ...circleButton, width: 34, height: 34, fontSize: 15 }} onClick={() => shift(interval)}>+</button>
    </div>
  );
}

// ── the module ──────────────────────────────────────────────────────────────

/**
 * @param {object}   props
 * @param {object}   props.config            reservation_config payload
 * @param {Array}    props.weeklyServices    reservation_services rows
 * @param {Array}    props.exceptions        reservation_calendar_rules rows
 * @param {Array}    props.bookings          upcoming reservations (impact warnings only)
 * @param {Array}    props.audit             reservation_admin_audit rows, newest first
 * @param {Function} props.onSave            async ({ config, weeklyServices, exceptions, changes }) => void
 * @param {boolean}  props.canEdit           false for Host / Read-only roles
 */
export default function ReservationsAdminPanel({
  config,
  weeklyServices,
  exceptions = [],
  bookings = [],
  audit = [],
  onSave,
  canEdit = true,
}) {
  const applied = useMemo(() => ({
    config: normalizeReservationConfig(config),
    weeklyServices: (weeklyServices && weeklyServices.length ? weeklyServices : DEFAULT_WEEKLY_SERVICES).map((row) => ({ ...row })),
    exceptions: exceptions.map((row) => ({ ...row })),
  }), [config, weeklyServices, exceptions]);

  const [section, setSection] = useState("overview");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [wizard, setWizard] = useState(null);
  const [notice, setNotice] = useState("");

  const current = draft || applied;
  const dirty = Boolean(draft);

  const edit = (mutate) => {
    if (!canEdit) { setNotice("Your role can view these settings but not change them."); return; }
    const next = draft ? clone(draft) : clone(applied);
    mutate(next);
    setDraft(next);
    setStatus("idle");
  };

  const serviceRow = (state, service, weekday) =>
    state.weeklyServices.find((row) => row.service === service && Number(row.weekday) === weekday);

  const editServiceRow = (service, weekday, patch) => edit((next) => {
    let row = serviceRow(next, service, weekday);
    if (!row) {
      row = {
        service, weekday, enabled: false,
        first: service === "lunch" ? "12:00" : "18:00",
        last: service === "lunch" ? "13:30" : "19:30",
        interval: 30, onlineEnabled: true,
      };
      next.weeklyServices.push(row);
    }
    Object.assign(row, patch);
  });

  // ── impact: same domain functions the booking API uses ────────────────────
  const changes = useMemo(() => {
    if (!draft) return [];
    const rows = [];
    const push = (label, from, to, warning) => rows.push({ label, from: String(from), to: String(to), warning: warning || "" });
    const a = applied;
    const b = draft;

    WEEKDAYS.forEach(([weekday, dayName]) => {
      SERVICE_NAMES.forEach((service) => {
        const before = serviceRow(a, service, weekday);
        const after = serviceRow(b, service, weekday);
        const wasOn = Boolean(before?.enabled);
        const nowOn = Boolean(after?.enabled);
        const label = `${dayName} ${service}`;
        if (wasOn !== nowOn) {
          push(label, wasOn ? "served" : "not served", nowOn ? "served" : "not served",
            nowOn ? "" : impactOfRemovedTimes(before ? generateSlots(before.first, before.last, before.interval) : [], service, weekday, bookings));
          return;
        }
        if (!wasOn || !after) return;
        const beforeSlots = generateSlots(before.first, before.last, before.interval);
        const afterSlots = generateSlots(after.first, after.last, after.interval);
        if (beforeSlots.join(" ") !== afterSlots.join(" ")) {
          const removed = beforeSlots.filter((time) => !afterSlots.includes(time));
          push(`${label} times`, `${before.first}–${before.last} every ${before.interval} min`,
            `${after.first}–${after.last} every ${after.interval} min`,
            removed.length ? impactOfRemovedTimes(removed, service, weekday, bookings) : "");
        }
        if (before.onlineEnabled !== after.onlineEnabled) {
          push(`${label} online booking`, before.onlineEnabled === false ? "staff only" : "guests may book",
            after.onlineEnabled === false ? "staff only" : "guests may book",
            after.onlineEnabled === false ? "Guests can no longer book this service online. Staff can still take bookings by phone." : "");
        }
        // Compared as the engine reads it (absent means allowed), so a row that
        // simply never carried the key does not read as a change.
        if ((before.walkInsEnabled !== false) !== (after.walkInsEnabled !== false)) {
          push(`${label} walk-ins`, before.walkInsEnabled === false ? "not taken" : "taken",
            after.walkInsEnabled === false ? "not taken" : "taken", "");
        }
      });
    });

    const pairs = [
      ["online.enabled", "Online booking", (v) => (v === false ? "paused" : "open to guests")],
      ["online.maxPax", "Largest party bookable online", (v) => `${v} guests`],
      ["online.minPax", "Smallest party bookable online", (v) => `${v} guests`],
      ["online.autoConfirmMaxPax", "Automatically confirm parties up to", (v) => `${v} guests`],
      ["online.leadMinutes", "How close to arrival guests may book", (v) => `${v} min`],
      ["online.windowDays", "How far ahead guests may book", (v) => `${v} days`],
      ["pacing.coversPerSlot", "Guests arriving at the same time", (v) => `${v} covers`],
      ["pacing.coversPerService", "Guests per service", (v) => `${v} covers`],
      ["durations.small", "Table time — up to 2 guests", hours],
      ["durations.medium", "Table time — 3 to 5 guests", hours],
      ["durations.large", "Table time — 6 or more", hours],
      ["durations.buffer", "Reset time between parties", (v) => `${v} min`],
      ["walkIns.enabled", "Walk-ins", (v) => (v === false ? "not taken" : "taken")],
      ["walkIns.holdMinutes", "How long a walk-in table is held", (v) => `${v} min`],
      ["waitlist.defaultQuoteMinutes", "Wait we quote by default", (v) => `${v} min`],
      ["privacy.retentionMonths", "Guest history kept for", (v) => `${v} months`],
    ];
    const read = (obj, path) => path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
    pairs.forEach(([path, label, format]) => {
      const before = read(a.config, path);
      const after = read(b.config, path);
      if (before === after) return;
      let warning = "";
      if (path === "pacing.coversPerSlot" || path === "pacing.coversPerService") {
        const busiest = busiestLoad(bookings, path === "pacing.coversPerSlot");
        if (busiest.covers > Number(after)) {
          warning = `${busiest.label} already holds ${busiest.covers} covers, above the new limit. Existing bookings stay; new ones are refused.`;
        }
      }
      if (path === "online.autoConfirmMaxPax" && Number(after) === 0) {
        warning = "Every online booking will wait as pending until someone confirms it.";
      }
      if (path === "online.enabled" && after === false) {
        warning = "Guests cannot book from the public page at all while this is paused. Staff bookings, the day book and the calendar are unaffected.";
      }
      push(label, format(before), format(after), warning);
    });

    if (JSON.stringify(a.exceptions) !== JSON.stringify(b.exceptions)) {
      const added = b.exceptions.filter((rule) => !a.exceptions.some((old) => sameException(old, rule)));
      const affected = bookings.filter((booking) => added.some((rule) => rule.date === booking.date) && ACTIVE_STATUSES.has(booking.status));
      push("Calendar exceptions", `${a.exceptions.length} dates`, `${b.exceptions.length} dates`,
        affected.length ? `${affected.length} existing reservation${affected.length > 1 ? "s" : ""} on those dates need a personal call — they are not cancelled automatically.` : "");
    }
    if (JSON.stringify(a.config.tables) !== JSON.stringify(b.config.tables)) {
      const gone = a.config.tables.filter((table) => !b.config.tables.some((next) => next.id === table.id));
      // A combined party holds its whole group, which travels in operationalData.
      const heldBy = (booking) => {
        const group = booking.operationalData?.tableGroup;
        return Array.isArray(group) && group.length ? group.map(String) : [String(booking.tableLabel || "")];
      };
      const affected = bookings.filter((booking) => gone.some((table) => heldBy(booking).includes(String(table.id))) && ACTIVE_STATUSES.has(booking.status));
      push("Bookable tables", `${a.config.tables.length} tables`, `${b.config.tables.length} tables`,
        affected.length ? `${gone.map((table) => table.id).join(", ")} still hold ${affected.length} upcoming reservation${affected.length > 1 ? "s" : ""} — move them first.` : "");
    }
    ["experiences", "messages", "team", "publicPage"].forEach((key) => {
      if (JSON.stringify(a.config[key]) !== JSON.stringify(b.config[key])) {
        push(({ experiences: "Experiences", messages: "Guest messages", team: "Team access", publicPage: "Public booking page" })[key], "current", "updated", "");
      }
    });
    return rows;
  }, [draft, applied, bookings]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setStatus("saving");
    try {
      await onSave({
        config: current.config,
        weeklyServices: current.weeklyServices,
        exceptions: current.exceptions,
        changes,
      });
      setUndoSnapshot(clone(applied));
      setDraft(null);
      setReview(null);
      setStatus("saved");
      setNotice("Saved. Guests and the day book are using these settings now.");
    } catch (error) {
      setStatus("error");
      setNotice(error?.message || "Those settings could not be saved. Nothing was changed.");
    }
  }

  const visibleSections = SECTIONS.filter(([, label, hint]) =>
    !query.trim() || `${label} ${hint}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div style={{ fontFamily: FONT, color: tokens.ink[0] }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={sectionHeader}>Reservations</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a href="/book" target="_blank" rel="noreferrer" style={{ ...primaryBtn, textDecoration: "none", whiteSpace: "nowrap" }}>Preview booking page</a>
          <a href="/book?test=1" target="_blank" rel="noreferrer" style={{ ...panelBtn(false), padding: "8px 14px", textDecoration: "none", whiteSpace: "nowrap" }}>Test a booking</a>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <nav style={{ width: 232, flex: "0 0 232px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0] }}>
          <div style={{ padding: 10, borderBottom: `1px solid ${tokens.ink[5]}` }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SEARCH SETTINGS"
              style={{ ...baseInp, fontSize: 10, letterSpacing: 1, padding: "8px 9px" }}
            />
          </div>
          {visibleSections.map(([key, label, hint]) => {
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                style={{
                  display: "block", width: "100%", textAlign: "left", fontFamily: FONT, cursor: "pointer",
                  padding: "10px 12px", border: "none", borderBottom: `1px solid ${tokens.ink[5]}`,
                  borderLeft: `2px solid ${active ? tokens.green.border : "transparent"}`,
                  background: active ? tokens.green.bg : tokens.neutral[0],
                  color: active ? tokens.green.text : tokens.ink[2],
                  fontSize: 10, letterSpacing: 0.6, fontWeight: active ? 600 : 400,
                }}
              >
                {label}
                <span style={{ display: "block", fontSize: 8, letterSpacing: 0.4, color: tokens.ink[3], marginTop: 2 }}>{hint}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1, minWidth: 320, maxWidth: 820 }}>
          {section === "overview" ? (
            <Overview current={current} onGo={setSection} onWizard={() => setWizard({ step: 1 })} onDefaults={() => edit((next) => {
              next.weeklyServices = DEFAULT_WEEKLY_SERVICES.map((row) => ({ ...row }));
              next.config = normalizeReservationConfig({ ...next.config, online: undefined, pacing: undefined, durations: undefined });
            })} />
          ) : null}

          {section === "hours" ? (
            <WeeklySchedule
              state={current}
              onToggle={(service, weekday, enabled) => editServiceRow(service, weekday, { enabled })}
              onPatch={editServiceRow}
              onCopy={(service, fromWeekday) => edit((next) => {
                const source = serviceRow(next, service, fromWeekday);
                if (!source) return;
                WEEKDAYS.forEach(([weekday]) => {
                  if (weekday === fromWeekday) return;
                  const target = serviceRow(next, service, weekday);
                  const patch = { first: source.first, last: source.last, interval: source.interval };
                  if (target) Object.assign(target, patch);
                  else next.weeklyServices.push({ service, weekday, enabled: false, onlineEnabled: true, ...patch });
                });
              })}
            />
          ) : null}

          {section === "calendar" ? (
            <CalendarExceptions
              state={current}
              onAdd={(rule) => edit((next) => { next.exceptions = [...next.exceptions.filter((row) => !sameException(row, rule)), rule]; })}
              onRemove={(rule) => edit((next) => {
                // The draft is cloned on every edit, so the row handed back is
                // never the same object — a saved rule is found again by its id.
                next.exceptions = rule.id
                  ? next.exceptions.filter((row) => row.id !== rule.id)
                  : next.exceptions.filter((row) => !sameException(row, rule));
              })}
            />
          ) : null}

          {section === "capacity" ? (
            <Capacity config={current.config} onEdit={edit} advanced={advanced} onAdvanced={setAdvanced} />
          ) : null}

          {section === "tables" ? (
            <Tables config={current.config} onEdit={edit} />
          ) : null}

          {section === "rules" ? (
            <BookingRules config={current.config} onEdit={edit} />
          ) : null}

          {section === "experiences" ? (
            <Experiences config={current.config} onEdit={edit} />
          ) : null}

          {section === "public" ? (
            <PublicPage config={current.config} state={current} onEdit={edit} />
          ) : null}

          {section === "messages" ? (
            <Messages config={current.config} onEdit={edit} />
          ) : null}

          {section === "waitlist" ? (
            <Waitlist config={current.config} onEdit={edit} />
          ) : null}

          {section === "privacy" ? (
            <Privacy config={current.config} onEdit={edit} />
          ) : null}

          {section === "permissions" ? (
            <Permissions config={current.config} onEdit={edit} />
          ) : null}

          {section === "audit" ? (
            <AuditLog rows={audit} />
          ) : null}
        </div>
      </div>

      {notice ? (
        <div style={{ marginTop: 14, padding: "10px 12px", background: status === "error" ? tokens.red.bg : tokens.green.bg, border: `1px solid ${status === "error" ? tokens.red.border : tokens.green.border}`, color: status === "error" ? tokens.red.text : tokens.green.text, fontSize: 10, letterSpacing: 1 }}>
          {notice}
        </div>
      ) : null}

      {dirty ? (
        <div style={{ position: "sticky", bottom: 0, marginTop: 18, padding: "10px 12px", background: tokens.neutral[0], borderTop: `1px solid ${tokens.charcoal.default}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, letterSpacing: 1.2, color: tokens.signal.active, fontWeight: 600 }}>
            UNSAVED — {changes.length} SETTING{changes.length === 1 ? "" : "S"}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" style={{ ...panelBtn(false), padding: "8px 14px" }} onClick={() => { setDraft(null); setNotice("Changes discarded. Nothing was saved."); }}>Cancel</button>
            <button type="button" style={primaryBtn} onClick={() => setReview(changes.length ? changes : [{ label: "No effective change", from: "—", to: "—", warning: "" }])}>What will change?</button>
          </span>
        </div>
      ) : undoSnapshot ? (
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...panelBtn(false), padding: "7px 11px" }} onClick={() => { setDraft(clone(undoSnapshot)); setUndoSnapshot(null); setNotice("Previous settings restored as unsaved changes — review and save to apply."); }}>
            ↶ Undo last save
          </button>
        </div>
      ) : null}

      {review ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={{ ...modalContent, width: "min(620px, 96vw)", padding: 18 }}>
            <div style={sectionHeader}>What will change</div>
            {review.map((row, index) => (
              <div key={index} style={{ borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}>
                <div style={{ fontSize: 11, color: tokens.ink[0] }}>{row.label}</div>
                <div style={{ fontSize: 10, color: tokens.ink[3], marginTop: 3 }}>
                  {row.from} → <strong style={{ color: tokens.ink[0] }}>{row.to}</strong>
                </div>
                {row.warning ? (
                  <div style={{ fontSize: 10, lineHeight: 1.6, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "6px 8px", marginTop: 6 }}>
                    {row.warning}
                  </div>
                ) : null}
              </div>
            ))}
            <div style={{ fontSize: 10, lineHeight: 1.7, color: tokens.ink[3], marginTop: 10 }}>
              Applies to the day book, the calendar and the public booking page together. Existing reservations are never changed or cancelled by a settings change. Every line above is written to the audit log.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...panelBtn(false), padding: "8px 14px" }} onClick={() => setReview(null)}>Keep editing</button>
              <button type="button" style={saveBtn(status)} disabled={status === "saving"} onClick={save}>
                {status === "saving" ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wizard ? (
        <SetupWizard
          step={wizard.step}
          state={current}
          onClose={() => setWizard(null)}
          onStep={(step) => setWizard({ step })}
          onApply={(answers) => {
            edit((next) => {
              WEEKDAYS.forEach(([weekday]) => {
                const dinner = serviceRow(next, "dinner", weekday) || (next.weeklyServices.push({ service: "dinner", weekday, enabled: false, onlineEnabled: true, first: "18:00", last: "19:30", interval: 30 }), serviceRow(next, "dinner", weekday));
                if (answers.dinnerDays.includes(weekday)) {
                  Object.assign(dinner, { enabled: true, first: answers.first, last: answers.last, interval: answers.interval });
                } else {
                  dinner.enabled = false;
                }
                const lunch = serviceRow(next, "lunch", weekday);
                if (lunch) lunch.enabled = answers.lunchDays.includes(weekday);
                else if (answers.lunchDays.includes(weekday)) {
                  next.weeklyServices.push({ service: "lunch", weekday, enabled: true, onlineEnabled: true, first: "12:00", last: "13:30", interval: answers.interval });
                }
              });
              next.config.durations = { ...next.config.durations, small: answers.hold, medium: answers.hold + 30, large: answers.hold + 60 };
              next.config.pacing = { ...next.config.pacing, coversPerSlot: answers.perSlot };
              next.config.online = { ...next.config.online, autoConfirmMaxPax: answers.autoConfirm };
            });
            setWizard(null);
            setSection("hours");
          }}
        />
      ) : null}
    </div>
  );
}

// ── impact helpers ──────────────────────────────────────────────────────────

function impactOfRemovedTimes(removedTimes, service, weekday, bookings) {
  if (!removedTimes.length) return "";
  const hits = bookings.filter((booking) =>
    ACTIVE_STATUSES.has(booking.status)
    && booking.service === service
    && removedTimes.includes(booking.time)
    && dateWeekday(booking.date) === weekday);
  const plural = removedTimes.length > 1 ? "s" : "";
  if (!hits.length) return `This removes ${removedTimes.length} bookable time${plural} (${removedTimes.join(", ")}). No existing reservation sits on them.`;
  return `This removes ${removedTimes.length} bookable time${plural} (${removedTimes.join(", ")}) which currently hold ${hits.length} reservation${hits.length > 1 ? "s" : ""}. Those bookings keep their time; guests simply cannot book it any more.`;
}

function busiestLoad(bookings, perSlot) {
  const totals = new Map();
  bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status)).forEach((booking) => {
    const key = perSlot ? `${booking.date} ${booking.time}` : `${booking.date} ${booking.service}`;
    totals.set(key, (totals.get(key) || 0) + Number(booking.pax || 0));
  });
  let best = { label: "The busiest service", covers: 0 };
  totals.forEach((covers, label) => { if (covers > best.covers) best = { label, covers }; });
  return best;
}

// ── sections ────────────────────────────────────────────────────────────────

function Card({ children, tone }) {
  return (
    <div style={{
      background: tone === "quiet" ? tokens.tint.parchment : tokens.neutral[0],
      border: `1px solid ${tokens.ink[4]}`, padding: "14px 16px", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Overview({ current, onGo, onWizard, onDefaults }) {
  const { config, weeklyServices } = current;
  const openDinner = weeklyServices.filter((row) => row.service === "dinner" && row.enabled).length;
  const openLunch = weeklyServices.filter((row) => row.service === "lunch" && row.enabled).length;
  const cards = [
    ["When are we open?", `Dinner on ${openDinner} day${openDinner === 1 ? "" : "s"} a week, lunch on ${openLunch}.`, "hours"],
    ["How should bookings work?", `Parties up to ${config.online.autoConfirmMaxPax} are confirmed straight away; larger ones wait for a look.`, "rules"],
    ["How many guests can we accept?", `${config.pacing.coversPerSlot} arriving together, ${config.pacing.coversPerService} across a service.`, "capacity"],
    ["Which tables can be booked?", `${config.tables.length} tables, up to ${Math.max(...config.tables.map((table) => Number(table.seats)))} seats.`, "tables"],
    ["What will guests see?", config.tagline, "public"],
    ["What messages should guests receive?", "Confirmation and reminder drafts, ready for when sending is switched on.", "messages"],
    ["Who can access Reservations?", `${(config.team || []).length || "Roles from"} Admin, Manager, Host and Read-only.`, "permissions"],
  ];
  return (
    <>
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: tokens.ink[0], lineHeight: 1.6 }}>Reservations are running on your own settings.</div>
            <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 4 }}>
              Tables held about {hours(durationForParty(2, config))} for two. Guests may book {config.online.windowDays} days ahead, up to {config.online.leadMinutes} minutes before arrival.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" style={primaryBtn} onClick={onWizard}>Guided setup</button>
            <button type="button" style={{ ...panelBtn(false), padding: "8px 14px" }} onClick={onDefaults}>Restore recommended</button>
          </div>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {cards.map(([question, answer, key]) => (
          <button key={key} type="button" onClick={() => onGo(key)} style={{ textAlign: "left", fontFamily: FONT, background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "14px 16px", cursor: "pointer" }}>
            <div style={{ fontSize: 12, color: tokens.ink[0] }}>{question}</div>
            <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 5 }}>{answer}</div>
            <div style={{ fontSize: 9, letterSpacing: 1, color: tokens.green.text, marginTop: 8 }}>Open →</div>
          </button>
        ))}
      </div>
    </>
  );
}

function WeeklySchedule({ state, onToggle, onPatch, onCopy }) {
  const [service, setService] = useState("dinner");
  const rows = WEEKDAYS.map(([weekday, dayName]) => {
    const row = state.weeklyServices.find((item) => item.service === service && Number(item.weekday) === weekday);
    return { weekday, dayName, row };
  });
  return (
    <>
      <Card>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Which service are you setting up?</div>
        <Choice options={[["dinner", "Dinner"], ["lunch", "Lunch"]]} value={service} onChange={setService} />
        <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 8 }}>
          Each day is set on its own — Milka does not serve lunch every day. A day switched off shows no times anywhere: not on the booking page, not in the day book, not in the calendar.
        </div>
      </Card>
      {rows.map(({ weekday, dayName, row }) => {
        const on = Boolean(row?.enabled);
        return (
          <Card key={weekday}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: on ? tokens.ink[0] : tokens.ink[3], minWidth: 96 }}>{dayName}</span>
              <button type="button" style={toggleBtn(on)} onClick={() => onToggle(service, weekday, !on)}>
                {on ? `WE SERVE ${service.toUpperCase()}` : "CLOSED FOR THIS SERVICE"}
              </button>
            </div>
            {on && row ? (
              <>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>First seating</div>
                    <TimeStepper value={row.first} onChange={(value) => onPatch(service, weekday, { first: value })} />
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>Last seating</div>
                    <TimeStepper value={row.last} onChange={(value) => onPatch(service, weekday, { last: value })} />
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>How often can guests book?</div>
                    <Choice
                      options={[[15, "Every 15 min"], [30, "Every 30 min"]]}
                      value={Number(row.interval || 30)}
                      onChange={(value) => onPatch(service, weekday, { interval: Number(value) })}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                  {generateSlots(row.first, row.last, row.interval).map((time) => (
                    <span key={time} style={{ ...chip, background: tokens.green.bg, borderColor: tokens.green.border, color: tokens.green.text, fontWeight: 600 }}>{time}</span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" style={toggleBtn(row.onlineEnabled !== false)} onClick={() => onPatch(service, weekday, { onlineEnabled: row.onlineEnabled === false })}>
                    {row.onlineEnabled === false ? "STAFF BOOKINGS ONLY" : "GUESTS MAY BOOK ONLINE"}
                  </button>
                  <button type="button" style={toggleBtn(row.walkInsEnabled !== false)} onClick={() => onPatch(service, weekday, { walkInsEnabled: row.walkInsEnabled === false })}>
                    {row.walkInsEnabled === false ? "NO WALK-INS" : "WALK-INS WELCOME"}
                  </button>
                  <button type="button" style={{ ...panelBtn(false), padding: "6px 12px" }} onClick={() => onCopy(service, weekday)}>
                    Copy these times to every day
                  </button>
                </div>
              </>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

function CalendarExceptions({ state, onAdd, onRemove }) {
  const [date, setDate] = useState("");
  const [kind, setKind] = useState("closed");
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [service, setService] = useState("dinner");
  const [mode, setMode] = useState("on");
  const [first, setFirst] = useState("18:00");
  const [last, setLast] = useState("19:30");
  const [slotInterval, setSlotInterval] = useState(30);
  const [onlineOff, setOnlineOff] = useState(false);
  const kinds = [
    ["closed", "Closed all day"],
    ["private_event", "Private event"],
    ["capacity_override", "Different capacity"],
    ["service_override", "Different hours"],
  ];
  const preview = date ? resolveServicesForDate(date, state.weeklyServices, state.exceptions) : [];
  return (
    <>
      <Card>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Make one date different from the normal week</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>Date</div>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ ...baseInp, width: 170 }} />
          </div>
          <div>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>What is different?</div>
            <Choice options={kinds} value={kind} onChange={setKind} />
          </div>
        </div>
        {kind === "private_event" ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>What is the occasion?</div>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Wedding party" style={{ ...baseInp, maxWidth: 280 }} />
          </div>
        ) : null}
        {kind === "capacity_override" ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>How many covers that day?</div>
            <input value={capacity} onChange={(event) => setCapacity(event.target.value.replace(/\D/g, ""))} placeholder="16" style={{ ...baseInp, width: 110 }} />
            {Number(capacity) < 1 ? (
              <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 6 }}>
                Tell us how many covers before adding this one.
              </div>
            ) : null}
          </div>
        ) : null}
        {kind === "service_override" ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>Which service is different?</div>
            <Choice
              options={[["dinner", "Dinner"], ["lunch", "Lunch"]]}
              value={service}
              onChange={(value) => {
                setService(value);
                setFirst(value === "lunch" ? "12:00" : "18:00");
                setLast(value === "lunch" ? "13:30" : "19:30");
              }}
            />
            <div style={{ ...fieldLabel, margin: "12px 0 6px" }}>What happens to it that day?</div>
            <Choice options={[["on", "Served, with these hours"], ["off", "Not served at all"]]} value={mode} onChange={setMode} />
            {mode === "on" ? (
              <>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>First seating</div>
                    <TimeStepper value={first} onChange={setFirst} />
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>Last seating</div>
                    <TimeStepper value={last} onChange={setLast} />
                  </div>
                  <div>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>How often can guests book?</div>
                    <Choice options={[[15, "Every 15 min"], [30, "Every 30 min"]]} value={slotInterval} onChange={(value) => setSlotInterval(Number(value))} />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button type="button" style={toggleBtn(!onlineOff)} onClick={() => setOnlineOff(!onlineOff)}>
                    {onlineOff ? "STAFF BOOKINGS ONLY" : "GUESTS MAY BOOK ONLINE"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            style={primaryBtn}
            disabled={!date || (kind === "capacity_override" && Number(capacity) < 1)}
            onClick={() => {
              if (!date) return;
              const rule = { date, kind };
              if (kind === "private_event") rule.label = label || "Private event";
              // Never send capacity 0 — the table only accepts a real number of covers.
              if (kind === "capacity_override") rule.capacity = Number(capacity);
              if (kind === "service_override") {
                rule.service = service;
                rule.mode = mode;
                if (mode === "on") {
                  rule.first = first;
                  rule.last = last;
                  rule.interval = slotInterval;
                  rule.onlineOff = onlineOff;
                }
              }
              onAdd(rule);
              setLabel(""); setCapacity("");
            }}
          >
            Add this exception
          </button>
        </div>
        {date ? (
          <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 10 }}>
            {preview.length
              ? `As it stands, that date offers: ${preview.map((item) => `${item.service} ${item.first}–${item.last}`).join(" · ")}.`
              : "As it stands, that date takes no bookings at all."}
          </div>
        ) : null}
      </Card>
      <Card>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Exceptions on the calendar</div>
        {state.exceptions.length === 0 ? (
          <div style={{ fontSize: 10, color: tokens.ink[3] }}>No closures, private events or capacity changes yet.</div>
        ) : state.exceptions.slice().sort((a, b) => a.date.localeCompare(b.date)).map((rule, index) => (
          <div key={`${rule.date}-${rule.kind}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}>
            <span style={{ fontSize: 11 }}>
              {rule.date} · {({ closed: "Closed", private_event: "Private event", capacity_override: "Capacity", service_override: "Different hours" })[rule.kind] || rule.kind}
              {rule.label ? ` · ${rule.label}` : ""}
              {rule.capacity ? ` · ${rule.capacity} covers` : ""}
              {rule.service ? ` · ${rule.service}` : ""}
              {rule.mode === "off" ? " · not served" : rule.first ? ` · ${rule.first}–${rule.last}` : ""}
              {rule.onlineOff ? " · staff only" : ""}
            </span>
            <button type="button" style={dangerBtn} onClick={() => onRemove(rule)}>Remove</button>
          </div>
        ))}
      </Card>
    </>
  );
}

function Capacity({ config, onEdit, advanced, onAdvanced }) {
  return (
    <>
      <Card>
        <Row label="How many guests can arrive at the same time?" hint="The kitchen sends one set of snacks per seating — this caps how many covers may book the same time.">
          <Stepper value={config.pacing.coversPerSlot} min={2} max={40} onChange={(value) => onEdit((next) => { next.config.pacing.coversPerSlot = value; })} format={(value) => `${value} covers`} />
        </Row>
        <Row label="How many guests across the whole service?">
          <Stepper value={config.pacing.coversPerService} min={4} max={200} step={2} onChange={(value) => onEdit((next) => { next.config.pacing.coversPerService = value; })} format={(value) => `${value} covers`} />
        </Row>
      </Card>
      <Card>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>How long should we keep each table?</div>
        {[["small", "Up to 2 guests"], ["medium", "3 to 5 guests"], ["large", "6 or more guests"]].map(([key, label]) => (
          <Row key={key} label={label}>
            <Stepper value={config.durations[key]} min={60} max={300} step={15} onChange={(value) => onEdit((next) => { next.config.durations[key] = value; })} format={hours} />
          </Row>
        ))}
        <div style={{ marginTop: 10 }}>
          <button type="button" style={{ ...panelBtn(advanced), padding: "6px 12px" }} onClick={() => onAdvanced(!advanced)}>
            {advanced ? "Hide advanced" : "Advanced"}
          </button>
        </div>
        {advanced ? (
          <Row label="Reset time between two parties on one table" hint="Time for clearing and re-laying the table before the next booking may start.">
            <Stepper value={config.durations.buffer} min={0} max={60} step={5} onChange={(value) => onEdit((next) => { next.config.durations.buffer = value; })} format={(value) => `${value} min`} />
          </Row>
        ) : null}
      </Card>
    </>
  );
}

function Tables({ config, onEdit }) {
  return (
    <>
      <Card tone="quiet">
        <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.7 }}>
          This is the reservation system’s own list of tables. Editing it never changes the service board or the floor plan.
        </div>
      </Card>
      <Card>
        {config.tables.map((table, index) => (
          <div key={table.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}>
            <span style={{ fontSize: 12, fontWeight: 700, minWidth: 48 }}>{table.id}</span>
            <Stepper
              value={Number(table.seats)}
              min={1}
              max={14}
              onChange={(value) => onEdit((next) => { next.config.tables[index].seats = value; })}
              format={(value) => `${value} seats`}
            />
            <button type="button" style={dangerBtn} onClick={() => onEdit((next) => { next.config.tables.splice(index, 1); })}>Not bookable</button>
          </div>
        ))}
        <button
          type="button"
          style={{ ...panelBtn(false), padding: "8px 12px", marginTop: 10 }}
          onClick={() => onEdit((next) => {
            // The id is what the availability engine keys occupancy on and it
            // cannot be edited afterwards, so take the first FREE number — after
            // a deletion the list length no longer tells us what is free.
            const taken = new Set(next.config.tables.map((table) => String(table.id)));
            let number = 1;
            while (taken.has(`T${String(number).padStart(2, "0")}`)) number += 1;
            next.config.tables.push({ id: `T${String(number).padStart(2, "0")}`, seats: 2 });
          })}
        >
          + Add a table
        </button>
      </Card>
      <Card>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Which tables can be joined together?</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {(config.combos || []).map((pair, index) => (
            <button key={pair.join("-")} type="button" style={{ ...chip, cursor: "pointer" }} title="Remove this pair" onClick={() => onEdit((next) => { next.config.combos.splice(index, 1); })}>
              {pair.join(" + ")} ×
            </button>
          ))}
          {(config.combos || []).length === 0 ? (
            <span style={{ fontSize: 10, color: tokens.ink[3] }}>No joined tables yet — larger parties will only fit a single table.</span>
          ) : null}
        </div>
        <JoinPicker tables={config.tables} onAdd={(pair) => onEdit((next) => {
          next.config.combos = [...(next.config.combos || []), pair];
        })} />
      </Card>
    </>
  );
}

function JoinPicker({ tables, onAdd }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
      {[[a, setA, "First table"], [b, setB, "Second table"]].map(([value, set, label]) => (
        <div key={label}>
          <div style={{ ...fieldLabel, marginBottom: 6 }}>{label}</div>
          <select value={value} onChange={(event) => set(event.target.value)} style={{ ...baseInp, width: 130 }}>
            <option value="">—</option>
            {tables.map((table) => <option key={table.id} value={table.id}>{table.id}</option>)}
          </select>
        </div>
      ))}
      <button type="button" style={{ ...panelBtn(false), padding: "8px 12px" }} disabled={!a || !b || a === b} onClick={() => { onAdd([a, b]); setA(""); setB(""); }}>
        Allow this pair
      </button>
    </div>
  );
}

function BookingRules({ config, onEdit }) {
  return (
    <>
      <Card>
        <Row label="Can guests book online at all?" hint="Pausing closes the booking page for every date at once. Staff keep taking bookings by telephone, and nothing already booked is touched.">
          <button type="button" style={toggleBtn(config.online.enabled !== false)} onClick={() => onEdit((next) => { next.config.online.enabled = next.config.online.enabled === false; })}>
            {config.online.enabled === false ? "ONLINE BOOKING PAUSED" : "GUESTS MAY BOOK ONLINE"}
          </button>
        </Row>
        <Row
          label="Automatically confirm parties up to…"
          hint={Number(config.online.autoConfirmMaxPax) === 0
            ? "Every online booking waits as pending until someone confirms it."
            : `Parties up to ${config.online.autoConfirmMaxPax} are confirmed straight away. Larger requests arrive as pending so you can look at the evening first.`}
        >
          <Stepper value={config.online.autoConfirmMaxPax} min={0} max={14} onChange={(value) => onEdit((next) => { next.config.online.autoConfirmMaxPax = value; })} format={(value) => `${value} guests`} />
        </Row>
        <Row label="Largest party bookable online" hint="Bigger groups are invited to leave a note or call, so you can arrange the evening personally.">
          <Stepper value={config.online.maxPax} min={1} max={20} onChange={(value) => onEdit((next) => { next.config.online.maxPax = value; })} format={(value) => `${value} guests`} />
        </Row>
        <Row label="Smallest party bookable online" hint="Below this, guests are asked to call so you can seat them yourself.">
          <Stepper value={config.online.minPax} min={1} max={Number(config.online.maxPax)} onChange={(value) => onEdit((next) => { next.config.online.minPax = value; })} format={(value) => `${value} guests`} />
        </Row>
        <Row label="How close to arrival can guests book?">
          <Stepper value={config.online.leadMinutes} min={0} max={240} step={15} onChange={(value) => onEdit((next) => { next.config.online.leadMinutes = value; })} format={(value) => `${value} min`} />
        </Row>
        <Row label="How far in advance can guests book?">
          <Stepper value={config.online.windowDays} min={7} max={365} step={7} onChange={(value) => onEdit((next) => { next.config.online.windowDays = value; })} format={(value) => `${value} days`} />
        </Row>
        <Row label="What happens when no table is available?">
          <Choice
            options={[["waitlist", "Offer the waitlist"], ["phone", "Show our phone number"]]}
            value={config.online.whenFull}
            onChange={(value) => onEdit((next) => { next.config.online.whenFull = value; })}
          />
        </Row>
      </Card>
      <Card>
        <Row label="Do we take walk-ins?" hint="A walk-in is a staff action at the door — the booking page never offers one.">
          <button type="button" style={toggleBtn(config.walkIns.enabled !== false)} onClick={() => onEdit((next) => { next.config.walkIns.enabled = next.config.walkIns.enabled === false; })}>
            {config.walkIns.enabled === false ? "NO WALK-INS" : "YES, WE TAKE WALK-INS"}
          </button>
        </Row>
        <Row label="How long do we hold a table for a walk-in?" hint="How long the door may keep a free table before it goes back to the booking page.">
          <Stepper value={config.walkIns.holdMinutes} min={5} max={60} step={5} onChange={(value) => onEdit((next) => { next.config.walkIns.holdMinutes = value; })} format={(value) => `${value} min`} />
        </Row>
      </Card>
      <Card>
        <Row label="No-show protection" hint="Card guarantees and deposits need a payment provider, which is not connected yet — so they are shown as unavailable rather than pretended.">
          <Choice
            options={[["none", "No requirement"], ["card", "Card guarantee", true, "Needs a payment provider"], ["deposit", "Deposit", true, "Needs a payment provider"]]}
            value="none"
            onChange={() => {}}
          />
        </Row>
      </Card>
    </>
  );
}

function Experiences({ config, onEdit }) {
  const list = config.experiences || [];
  return (
    <>
      {list.map((experience, index) => (
        <Card key={experience.key || index}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <input
              value={experience.title}
              onChange={(event) => onEdit((next) => { next.config.experiences[index].title = event.target.value; })}
              style={{ ...baseInp, fontSize: 13, fontWeight: 600, maxWidth: 260 }}
            />
            <button type="button" style={toggleBtn(experience.active !== false)} onClick={() => onEdit((next) => { next.config.experiences[index].active = experience.active === false; })}>
              {experience.active === false ? "HIDDEN" : "OFFERED"}
            </button>
          </div>
          <textarea
            value={experience.description || ""}
            onChange={(event) => onEdit((next) => { next.config.experiences[index].description = event.target.value; })}
            style={{ ...baseInp, minHeight: 52, marginTop: 8, lineHeight: 1.6, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {SERVICE_NAMES.map((service) => {
              const on = (experience.services || SERVICE_NAMES).includes(service);
              return (
                <button
                  key={service}
                  type="button"
                  style={toggleBtn(on)}
                  onClick={() => onEdit((next) => {
                    const target = next.config.experiences[index];
                    const services = target.services || [...SERVICE_NAMES];
                    target.services = on ? services.filter((item) => item !== service) : [...services, service];
                  })}
                >
                  {service.toUpperCase()}
                </button>
              );
            })}
          </div>
        </Card>
      ))}
      <button
        type="button"
        style={{ ...panelBtn(false), padding: "8px 12px" }}
        onClick={() => onEdit((next) => {
          next.config.experiences = [...(next.config.experiences || []), {
            key: `experience_${Date.now()}`, title: "New experience", description: "Describe it for guests.",
            services: ["dinner"], active: false,
          }];
        })}
      >
        + Add an experience
      </button>
    </>
  );
}

function PublicPage({ config, state, onEdit }) {
  const today = new Date().toISOString().slice(0, 10);
  const services = resolveServicesForDate(today, state.weeklyServices, state.exceptions, { publicOnly: true });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 240px", gap: 14, alignItems: "start" }}>
      <div>
        <Card>
          <Row label="Restaurant name">
            <input value={config.restaurantName} onChange={(event) => onEdit((next) => { next.config.restaurantName = event.target.value; })} style={baseInp} />
          </Row>
          <Row label="Welcome line">
            <textarea value={config.tagline} onChange={(event) => onEdit((next) => { next.config.tagline = event.target.value; })} style={{ ...baseInp, minHeight: 46, lineHeight: 1.6, resize: "vertical" }} />
          </Row>
          <Row label="Telephone">
            <input value={config.publicPage.phone} onChange={(event) => onEdit((next) => { next.config.publicPage.phone = event.target.value; })} style={{ ...baseInp, maxWidth: 220 }} />
          </Row>
          <Row label="Must a guest leave a telephone number?" hint="We need one way to reach a guest — leave at least one of these two required.">
            <button type="button" style={toggleBtn(config.publicPage.requirePhone !== false)} onClick={() => onEdit((next) => { next.config.publicPage.requirePhone = next.config.publicPage.requirePhone === false; })}>
              {config.publicPage.requirePhone === false ? "OPTIONAL" : "REQUIRED"}
            </button>
          </Row>
          <Row label="Must a guest leave an email address?" hint="Switch this off for a telephone-only booking page.">
            <button type="button" style={toggleBtn(config.publicPage.requireEmail !== false)} onClick={() => onEdit((next) => { next.config.publicPage.requireEmail = next.config.publicPage.requireEmail === false; })}>
              {config.publicPage.requireEmail === false ? "OPTIONAL" : "REQUIRED"}
            </button>
          </Row>
          <Row label="Languages guests can choose">
            <div style={{ display: "flex", gap: 6 }}>
              {[["en", "English"], ["sl", "Slovenščina"]].map(([code, label]) => {
                const on = (config.publicPage.languages || []).includes(code);
                return (
                  <button key={code} type="button" style={toggleBtn(on)} onClick={() => onEdit((next) => {
                    const languages = next.config.publicPage.languages || [];
                    next.config.publicPage.languages = on ? languages.filter((item) => item !== code) : [...languages, code];
                  })}>{label}</button>
                );
              })}
            </div>
          </Row>
          <Row label="Policies shown before confirming">
            <textarea value={config.publicPage.policies} onChange={(event) => onEdit((next) => { next.config.publicPage.policies = event.target.value; })} style={{ ...baseInp, minHeight: 72, lineHeight: 1.6, resize: "vertical" }} />
          </Row>
        </Card>
      </div>
      <div style={{ position: "sticky", top: 12 }}>
        <div style={{ fontSize: 8, letterSpacing: 1.2, color: tokens.ink[3], marginBottom: 6 }}>WHAT GUESTS SEE</div>
        <div style={{ background: tokens.tint.parchment, border: `1px solid ${tokens.ink[4]}`, padding: "16px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textAlign: "center" }}>{(config.restaurantName || "").toUpperCase()}</div>
          <div style={{ borderBottom: `1px solid ${tokens.ink[4]}`, margin: "10px 0" }} />
          <div style={{ fontSize: 12, color: tokens.ink[0] }}>Reserve a table</div>
          <div style={{ fontSize: 9, color: tokens.ink[2], lineHeight: 1.7, marginTop: 4 }}>{config.tagline}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
            {(services[0] ? generateSlots(services[0].first, services[0].last, services[0].interval) : []).slice(0, 4).map((time) => (
              <span key={time} style={{ ...chip, fontSize: 9, padding: "6px 8px" }}>{time}</span>
            ))}
            {services.length === 0 ? <span style={{ fontSize: 9, color: tokens.ink[3] }}>Closed today — guests see the next open date.</span> : null}
          </div>
          <div style={{ fontSize: 8, letterSpacing: 0.8, color: tokens.ink[3], marginTop: 10, lineHeight: 1.8 }}>{config.publicPage.phone}</div>
        </div>
        <a href="/book?test=1" target="_blank" rel="noreferrer" style={{ ...panelBtn(false), display: "block", textAlign: "center", padding: "9px 0", marginTop: 8, textDecoration: "none" }}>
          Test a booking
        </a>
      </div>
    </div>
  );
}

const MESSAGE_KINDS = [
  ["confirm", "Booking confirmation"],
  ["reminder", "Reminder"],
  ["modified", "Changed booking"],
  ["cancelled", "Cancellation"],
  ["waitlist", "A table has opened"],
];

function Messages({ config, onEdit }) {
  const messages = config.messages || {};
  return (
    <>
      <Card tone="quiet">
        <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.7 }}>
          Sending is not connected yet — these are the exact words that will go out once it is. Use {"{name} {date} {time} {pax} {ref}"} and the guest’s own details are filled in.
        </div>
      </Card>
      {MESSAGE_KINDS.map(([key, label]) => (
        <Card key={key}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{label}</div>
          {[["en", "English"], ["sl", "Slovenščina"]].map(([lang, langLabel]) => (
            <div key={lang} style={{ marginBottom: 8 }}>
              <div style={{ ...fieldLabel, marginBottom: 4 }}>{langLabel}</div>
              <textarea
                value={(messages[key] || {})[lang] || ""}
                onChange={(event) => onEdit((next) => {
                  next.config.messages = next.config.messages || {};
                  next.config.messages[key] = { ...(next.config.messages[key] || {}), [lang]: event.target.value };
                })}
                style={{ ...baseInp, minHeight: 44, lineHeight: 1.6, resize: "vertical" }}
              />
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}

function Waitlist({ config, onEdit }) {
  return (
    <Card>
      <Row label="Do we keep a waitlist?">
        <button type="button" style={toggleBtn(config.waitlist.enabled !== false)} onClick={() => onEdit((next) => { next.config.waitlist.enabled = next.config.waitlist.enabled === false; })}>
          {config.waitlist.enabled === false ? "NO WAITLIST" : "YES, KEEP A WAITLIST"}
        </button>
      </Row>
      <Row label="Wait we quote by default">
        <Stepper value={config.waitlist.defaultQuoteMinutes} min={5} max={120} step={5} onChange={(value) => onEdit((next) => { next.config.waitlist.defaultQuoteMinutes = value; })} format={(value) => `${value} min`} />
      </Row>
      <Row label="Suggest matches when a table frees up?" hint="Suggestions only. Nobody is ever called or messaged automatically — a person always decides.">
        <button type="button" style={toggleBtn(config.waitlist.autoSuggest !== false)} onClick={() => onEdit((next) => { next.config.waitlist.autoSuggest = next.config.waitlist.autoSuggest === false; })}>
          {config.waitlist.autoSuggest === false ? "NO SUGGESTIONS" : "SUGGEST MATCHES"}
        </button>
      </Row>
    </Card>
  );
}

function Privacy({ config, onEdit }) {
  return (
    <Card>
      <Row label="How long do we keep guest history?" hint="Older visits are anonymised automatically. The rule is the restaurant’s to set, not a developer’s.">
        <Stepper value={config.privacy.retentionMonths} min={6} max={120} step={6} onChange={(value) => onEdit((next) => { next.config.privacy.retentionMonths = value; })} format={(value) => `${value} months`} />
      </Row>
      <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 10 }}>
        Exporting a guest’s data and erasing a guest on request are done from the guest’s own profile in Reservations, so the action is recorded against that guest.
      </div>
    </Card>
  );
}

const ROLES = [
  ["admin", "Reservations Admin", "Everything, including these settings."],
  ["manager", "Manager", "Bookings, waitlist, overrides and exceptions — not settings."],
  ["host", "Host", "Take and change bookings and the waitlist."],
  ["readonly", "Read-only", "Can look at the day book and calendar, changes nothing."],
];

function Permissions({ config, onEdit }) {
  const team = config.team || [];
  return (
    <>
      <Card>
        {team.map((member, index) => (
          <div key={`${member.name}-${index}`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}>
            <span style={{ fontSize: 12, minWidth: 120 }}>{member.name}</span>
            <Choice options={ROLES.map(([key, label]) => [key, label])} value={member.role} onChange={(role) => onEdit((next) => { next.config.team[index].role = role; })} />
            <button type="button" style={dangerBtn} onClick={() => onEdit((next) => { next.config.team.splice(index, 1); })}>Remove</button>
          </div>
        ))}
        {team.length === 0 ? (
          <div style={{ fontSize: 10, color: tokens.ink[3] }}>Reservations uses the same people and sign-in as the rest of Admin. Give someone a reservation role here when they need one.</div>
        ) : null}
        <TeamAdd onAdd={(member) => onEdit((next) => { next.config.team = [...(next.config.team || []), member]; })} />
      </Card>
      <Card tone="quiet">
        {ROLES.map(([key, label, description]) => (
          <div key={key} style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.9 }}>
            <strong style={{ color: tokens.ink[0] }}>{label}</strong> — {description}
          </div>
        ))}
        <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 8 }}>
          Enforced by the Admin sign-in you already use — there is no second password for Reservations.
        </div>
      </Card>
    </>
  );
}

function TeamAdd({ onAdd }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("host");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ ...fieldLabel, marginBottom: 6 }}>Who needs a reservation role?</div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" style={{ ...baseInp, width: 170 }} />
      </div>
      <Choice options={ROLES.map(([key, label]) => [key, label])} value={role} onChange={setRole} />
      <button type="button" style={{ ...panelBtn(false), padding: "8px 12px" }} disabled={!name.trim()} onClick={() => { onAdd({ name: name.trim(), role }); setName(""); }}>
        Give them this role
      </button>
    </div>
  );
}

function AuditLog({ rows }) {
  return (
    <Card>
      <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginBottom: 10 }}>
        Every saved settings change: who, when, what it was, what it became. Day-to-day booking actions are recorded on each reservation instead, so this list stays readable.
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 10, color: tokens.ink[3] }}>No settings changes recorded yet.</div>
      ) : rows.map((row, index) => (
        <div key={index} style={{ fontSize: 10, borderBottom: `1px solid ${tokens.ink[5]}`, padding: "7px 0", lineHeight: 1.6 }}>
          <strong>{row.at}</strong> · {row.actor} · {row.section} · {row.from} → {row.to}
        </div>
      ))}
    </Card>
  );
}

// ── guided setup ────────────────────────────────────────────────────────────

function SetupWizard({ step, state, onClose, onStep, onApply }) {
  const dinner = state.weeklyServices.find((row) => row.service === "dinner" && row.enabled);
  const [answers, setAnswers] = useState(() => ({
    dinnerDays: state.weeklyServices.filter((row) => row.service === "dinner" && row.enabled).map((row) => Number(row.weekday)),
    lunchDays: state.weeklyServices.filter((row) => row.service === "lunch" && row.enabled).map((row) => Number(row.weekday)),
    first: dinner?.first || "18:00",
    last: dinner?.last || "19:30",
    interval: Number(dinner?.interval || 30),
    hold: state.config.durations.small,
    perSlot: state.config.pacing.coversPerSlot,
    autoConfirm: state.config.online.autoConfirmMaxPax,
  }));
  const set = (patch) => setAnswers((current) => ({ ...current, ...patch }));
  const toggleDay = (field, weekday) => set({
    [field]: answers[field].includes(weekday) ? answers[field].filter((day) => day !== weekday) : [...answers[field], weekday],
  });

  const steps = [
    {
      question: "Which evenings do you serve dinner?",
      body: (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {WEEKDAYS.map(([weekday, name]) => (
            <button key={weekday} type="button" style={toggleBtn(answers.dinnerDays.includes(weekday))} onClick={() => toggleDay("dinnerDays", weekday)}>{name.slice(0, 3)}</button>
          ))}
        </div>
      ),
    },
    {
      question: "And which days do you serve lunch?",
      hint: "Leave them all off if lunch is not served at the moment.",
      body: (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {WEEKDAYS.map(([weekday, name]) => (
            <button key={weekday} type="button" style={toggleBtn(answers.lunchDays.includes(weekday))} onClick={() => toggleDay("lunchDays", weekday)}>{name.slice(0, 3)}</button>
          ))}
        </div>
      ),
    },
    {
      question: "When does dinner begin and end?",
      hint: "First and last seating, and how often guests may book in between.",
      body: (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={{ ...fieldLabel, marginBottom: 6 }}>First</div><TimeStepper value={answers.first} onChange={(value) => set({ first: value })} /></div>
          <div><div style={{ ...fieldLabel, marginBottom: 6 }}>Last</div><TimeStepper value={answers.last} onChange={(value) => set({ last: value })} /></div>
          <Choice options={[[15, "Every 15 min"], [30, "Every 30 min"]]} value={answers.interval} onChange={(value) => set({ interval: Number(value) })} />
        </div>
      ),
    },
    {
      question: "How long should we keep a table for two?",
      hint: "Larger parties are given more time automatically.",
      body: <Stepper value={answers.hold} min={60} max={240} step={15} onChange={(value) => set({ hold: value })} format={hours} />,
    },
    {
      question: "How many guests can arrive at the same time?",
      body: <Stepper value={answers.perSlot} min={2} max={40} onChange={(value) => set({ perSlot: value })} format={(value) => `${value} covers`} />,
    },
    {
      question: "Automatically confirm parties up to…",
      hint: "Larger requests wait for a personal look before you promise the evening.",
      body: <Stepper value={answers.autoConfirm} min={0} max={14} onChange={(value) => set({ autoConfirm: value })} format={(value) => `${value} guests`} />,
    },
  ];
  const total = steps.length;
  const active = steps[step - 1];

  return (
    <div style={modalOverlay} role="dialog" aria-modal="true">
      <div style={{ ...modalContent, width: "min(560px, 96vw)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={sectionHeader}>Guided setup · {step} of {total}</div>
          <button type="button" style={{ ...panelBtn(false), padding: "4px 9px" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: tokens.ink[0], lineHeight: 1.6, margin: "10px 0 4px" }}>{active.question}</div>
        {active.hint ? <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginBottom: 12 }}>{active.hint}</div> : null}
        <div style={{ marginTop: 8 }}>{active.body}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
          <button type="button" style={{ ...panelBtn(false), padding: "8px 14px" }} onClick={() => (step > 1 ? onStep(step - 1) : onClose())}>← Back</button>
          <button type="button" style={primaryBtn} onClick={() => (step < total ? onStep(step + 1) : onApply(answers))}>
            {step < total ? "Next →" : "Finish — review changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
