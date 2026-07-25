// ReservationWorkspace — the reservation system's staff surface. Replaces the
// old Reservation Manager visually and functionally.
//
// CANONICAL SOURCE: reservation_bookings, delivered to this component as the
// flat booking UI model. This file never reads or writes the legacy
// `reservations` shape; that shape survives only as a read-compatibility
// adapter for the existing Service interface, which is not this component's
// business. Nothing here touches Service, Floor, Kitchen, KDS, service_tables
// or service_settings.
//
// Every legacy operational field travels untouched inside booking.operationalData
// (menuType, lang, guestType, room/rooms, birthday, cakeNote, restrictions with
// course positions, notes, tableGroup, courseOverrides, kitchenCourseNotes) so
// the kitchen ticket, service breakdown, weekly overview and allergy sheet keep
// working exactly as they do today.
//
// Booking UI model:
//   { id, date, service, time, pax, status, name, phone, email, language,
//     source, ref, tableLabel, experience, occasion, notes, allergies,
//     accessibility, consentNews, operationalData }

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { chip } from "../../styles/mixins.js";
import { BP, useIsMobile } from "../../hooks/useIsMobile.js";
import ResvForm from "./ResvForm.jsx";
import CenteredModal from "../ui/CenteredModal.jsx";
import { durationForParty, normalizeReservationConfig } from "../../domain/reservations/config.js";
import {
  dateWeekday,
  generateSlots,
  minutesOf,
  resolveServicesForDate,
} from "../../domain/reservations/availability.js";
import { statusLabel } from "../../domain/reservations/lifecycle.js";
import {
  activeLegacyReservations,
  bookingToLegacyReservation,
  legacyReservationToBooking,
} from "../../domain/reservations/bookingAdapter.js";

// The archive-based guest history the old manager showed, unchanged.
const GuestMemory = lazy(() => import("./GuestMemory.jsx"));

const FONT = tokens.font;
const TABS = [
  ["daybook", "Day Book", "Day"],
  ["timeline", "Timeline", "Time"],
  ["calendar", "Calendar", "Cal"],
  ["guests", "Guests", "Guests"],
  ["waitlist", "Waitlist", "Wait"],
  ["print", "Planning & Print", "Print"],
];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ACTIVE = new Set(["pending", "confirmed", "arrived"]);

const pad = (value) => String(value).padStart(2, "0");
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const shiftISO = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return isoOf(d); };
const mondayOf = (iso) => shiftISO(iso, -((dateWeekday(iso) + 6) % 7));
const dayLabel = (iso) => `${DAY_SHORT[dateWeekday(iso)]} ${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)}`;
const opsOf = (booking) => booking?.operationalData || {};
// ResvForm always writes a kitchenCourseNotes key, empty or not, so the presence
// of the object says nothing — only its contents mean the kitchen has a note.
const hasCourseNotes = (booking) => Object.keys(opsOf(booking).kitchenCourseNotes || {}).length > 0;

/** Tables a booking occupies — a combined party holds its whole group. */
function tablesOf(booking) {
  const group = opsOf(booking).tableGroup;
  if (Array.isArray(group) && group.length) return group.map(String);
  return booking.tableLabel ? [String(booking.tableLabel)] : [];
}

/** Restrictions, normalised for display; course positions are preserved. */
function restrictionsOf(booking) {
  const list = opsOf(booking).restrictions;
  if (Array.isArray(list) && list.length) {
    return list.map((item) => (typeof item === "string" ? { note: item } : item));
  }
  return Array.isArray(booking.allergies)
    ? booking.allergies.map((note) => ({ note }))
    : (booking.allergies ? [{ note: String(booking.allergies) }] : []);
}

const restrictionText = (item) => `${item.pos != null ? `course ${item.pos}: ` : ""}${item.note || item.detail || ""}`.trim();

/** View-side occupancy. The server remains the authority for what may be
 *  booked; this only decides what the host is shown. */
function busyTablesAt({ date, time, pax, bookings, config, excludeId }) {
  const start = minutesOf(time);
  const end = start + durationForParty(pax, config) + Number(config.durations.buffer || 0);
  const busy = new Set();
  bookings.forEach((booking) => {
    if (booking.date !== date || booking.id === excludeId || !ACTIVE.has(booking.status)) return;
    const from = minutesOf(booking.time);
    const to = from + durationForParty(booking.pax, config) + Number(config.durations.buffer || 0);
    if (start < to && from < end) tablesOf(booking).forEach((label) => busy.add(label));
  });
  return busy;
}

function suggestFor({ date, time, pax, bookings, config, excludeId }) {
  const busy = busyTablesAt({ date, time, pax, bookings, config, excludeId });
  const seatsOf = (label) => Number((config.tables.find((table) => String(table.id) === String(label)) || {}).seats || 0);
  const single = [...config.tables]
    .filter((table) => Number(table.seats) >= Number(pax) && !busy.has(String(table.id)))
    .sort((a, b) => Number(a.seats) - Number(b.seats) || String(a.id).localeCompare(String(b.id)))[0];
  if (single) return { tables: [String(single.id)], combined: false };
  const pair = (config.combos || [])
    .map((combo) => combo.map(String))
    .filter((combo) => combo.every((label) => seatsOf(label) > 0 && !busy.has(label)))
    .filter((combo) => combo.reduce((total, label) => total + seatsOf(label), 0) >= Number(pax))[0];
  return pair ? { tables: pair, combined: true } : null;
}

/** Tables this party could move to, and who would have to swap. */
function swapOptions({ booking, bookings, config }) {
  const start = minutesOf(booking.time);
  const end = start + durationForParty(booking.pax, config) + Number(config.durations.buffer || 0);
  return config.tables
    .filter((table) => Number(table.seats) >= Number(booking.pax))
    .map((table) => {
      const label = String(table.id);
      const occupant = bookings.find((other) => (
        other.date === booking.date && other.id !== booking.id && ACTIVE.has(other.status)
        && tablesOf(other).includes(label)
        && start < minutesOf(other.time) + durationForParty(other.pax, config) + Number(config.durations.buffer || 0)
        && minutesOf(other.time) < end
      )) || null;
      return { table: label, seats: Number(table.seats), occupant, free: !occupant };
    });
}

const box = { background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}` };
const label9 = { fontFamily: FONT, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: tokens.ink[3] };
const pill = (active) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "8px 13px", cursor: "pointer", borderRadius: 0,
  border: `1px solid ${active ? tokens.green.border : tokens.ink[4]}`,
  background: active ? tokens.green.bg : tokens.neutral[0],
  color: active ? tokens.green.text : tokens.ink[3],
  fontWeight: active ? 600 : 400, whiteSpace: "nowrap", minHeight: 34,
});
const quiet = { ...pill(false) };
const strong = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "9px 18px", cursor: "pointer", borderRadius: 0,
  border: `1px solid ${tokens.charcoal.default}`, background: tokens.neutral[0], color: tokens.ink[0],
  fontWeight: 600, whiteSpace: "nowrap", minHeight: 38,
};

/**
 * @param {Array}    bookings          reservation_bookings in the booking UI model
 * @param {string}   serviceDate       the date the app considers current (ISO)
 * @param {string}   activeService     "lunch" | "dinner"
 * @param {object}   reservationConfig reservation configuration
 * @param {Array}    weeklyServices    per-weekday service rows
 * @param {Array}    calendarRules     closures, private events, overrides
 * @param {Array}    waitlist          waiting entries
 * @param {Array}    tables            table inventory for ResvForm (falls back to config.tables)
 * @param {Function} onSaveBooking     (booking) => Promise
 * @param {Function} onDeleteBooking   (id) => Promise
 * @param {Function} onStatusChange    ({ id, to, reason }) => Promise
 * @param {Function} onAssignTables    ({ id, tables }) => Promise
 * @param {Function} onSwapBookings    ({ aId, bId }) => Promise
 * @param {Function} onResolveConflict passed straight to ResvForm
 * @param {Function} onConvertWaitlist / onRemoveWaitlist
 * @param {Function} onPrintKitchenTicket / onPrintBreakdown / onPrintAllergySheet / onPrintWeekly
 * @param {boolean}  canEdit
 */
export default function ReservationWorkspace({
  bookings = [],
  serviceDate,
  activeService = "dinner",
  reservationConfig,
  weeklyServices = [],
  calendarRules = [],
  waitlist = [],
  tables,
  onSaveBooking,
  onDeleteBooking,
  onStatusChange,
  onAssignTables,
  onSwapBookings,
  onResolveConflict,
  onConvertWaitlist,
  onRemoveWaitlist,
  onPrintKitchenTicket,
  onPrintBreakdown,
  onPrintAllergySheet,
  onPrintWeekly,
  onExit,
  loading = false,
  error = "",
  onRetry,
  canEdit = true,
}) {
  const config = useMemo(() => normalizeReservationConfig(reservationConfig), [reservationConfig]);
  const formTables = tables && tables.length ? tables : config.tables;
  const compact = useIsMobile(BP.md);   // phone
  const narrow = useIsMobile(BP.lg);    // phone or tablet portrait

  const [tab, setTab] = useState("daybook");
  const [viewDate, setViewDate] = useState(serviceDate || isoOf(new Date()));
  const [service, setService] = useState(activeService);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [assignError, setAssignError] = useState("");
  const [guestQuery, setGuestQuery] = useState("");
  const [guestName, setGuestName] = useState(null);
  const [month, setMonth] = useState((serviceDate || isoOf(new Date())).slice(0, 7));
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState(null);   // booking whose record is open
  const [walkIn, setWalkIn] = useState(null);   // { pax } while a walk-in is being taken
  const noticeTimer = useRef(null);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  const dayServices = useMemo(
    () => resolveServicesForDate(viewDate, weeklyServices, calendarRules),
    [viewDate, weeklyServices, calendarRules],
  );
  // Lunch is never assumed: if this weekday has no lunch row enabled, no lunch
  // seating appears anywhere in this component.
  const activeDayService = dayServices.find((item) => item.service === service) || dayServices[0] || null;
  const seatings = activeDayService
    ? generateSlots(activeDayService.first, activeDayService.last, activeDayService.interval)
    : [];

  const dayBookings = useMemo(
    () => bookings
      .filter((booking) => booking.date === viewDate)
      .sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || String(a.name || "").localeCompare(String(b.name || ""))),
    [bookings, viewDate],
  );
  const serviceBookings = dayBookings.filter((booking) => booking.service === (activeDayService?.service || service));

  const counts = useMemo(() => {
    const live = serviceBookings.filter((booking) => ACTIVE.has(booking.status));
    return {
      covers: live.reduce((total, booking) => total + Number(booking.pax || 0), 0),
      parties: live.length,
      pending: serviceBookings.filter((booking) => booking.status === "pending").length,
      allergies: live.filter((booking) => restrictionsOf(booking).length > 0).length,
      unassigned: live.filter((booking) => tablesOf(booking).length === 0).length,
      cancelled: serviceBookings.filter((booking) => booking.status === "cancelled" || booking.status === "no_show").length,
    };
  }, [serviceBookings]);

  const shown = serviceBookings.filter((booking) => {
    if (filter === "all") return true;
    if (filter === "pending") return booking.status === "pending";
    if (filter === "allergy") return restrictionsOf(booking).length > 0;
    if (filter === "unassigned") return ACTIVE.has(booking.status) && tablesOf(booking).length === 0;
    if (filter === "cancelled") return booking.status === "cancelled" || booking.status === "no_show";
    return true;
  });
  // ResvForm treats every reservation it is given as occupying its table, so a
  // cancelled or no-show party would keep blocking one. Only live bookings go in.
  const legacyFormReservations = useMemo(
    () => activeLegacyReservations(bookings),
    [bookings],
  );

  const say = (message) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4000);
  };
  const guard = (action) => (...args) => {
    if (!canEdit) { say("Your role can view reservations but not change them."); return undefined; }
    return action?.(...args);
  };

  const context = {
    config, bookings: dayBookings, viewDate, seatings, compact, narrow,
    onDetail: (booking) => setDetail(booking),
    onEdit: guard((booking) => setEditing({ booking })),
    onAssign: guard((booking) => setAssigning(booking)),
    onStatus: guard((booking, to, reason) => onStatusChange?.({ id: booking.id, to, reason })),
    onGuest: (booking) => { setGuestName(booking.name); setTab("guests"); },
  };

  return (
    <div style={{ fontFamily: FONT, color: tokens.ink[0], padding: compact ? "10px 10px 40px" : "12px 14px 40px" }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10, overflowX: "auto" }}>
        {TABS.map(([key, full, short]) => (
          <button key={key} type="button" style={pill(tab === key)} onClick={() => setTab(key)}>
            {compact ? short : full}
          </button>
        ))}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 12,
        justifyContent: narrow ? "flex-start" : "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <button type="button" style={quiet} onClick={() => setViewDate(shiftISO(viewDate, -1))}>◀</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 118, textAlign: "center" }}>
            {dayLabel(viewDate)}<span style={{ color: tokens.ink[3], fontWeight: 400 }}> {viewDate.slice(0, 4)}</span>
          </span>
          <button type="button" style={quiet} onClick={() => setViewDate(shiftISO(viewDate, 1))}>▶</button>
          <button type="button" style={quiet} onClick={() => setViewDate(serviceDate || isoOf(new Date()))}>Today</button>
          {dayServices.length > 1 ? dayServices.map((item) => (
            <button key={item.service} type="button" style={pill(item.service === activeDayService?.service)} onClick={() => setService(item.service)}>
              {item.service}
            </button>
          )) : null}
        </div>
        <div style={{ display: "flex", gap: 5, width: compact ? "100%" : "auto" }}>
          {onExit ? (
            <button type="button" style={{ ...quiet, flex: compact ? 1 : "initial" }} onClick={onExit}>
              Exit
            </button>
          ) : null}
          <button type="button" style={{ ...quiet, flex: compact ? 1 : "initial" }} onClick={guard(() => setWalkIn({ pax: 2 }))}>
            Walk-in
          </button>
          <button type="button" style={{ ...strong, flex: compact ? 1 : "initial" }} onClick={guard(() => setEditing({ booking: null }))}>
            + New booking
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ ...box, padding: "9px 12px", marginBottom: 12, fontSize: 10, color: tokens.ink[3] }}>
          Refreshing reservations…
        </div>
      ) : null}

      {error ? (
        <div style={{ ...box, padding: "9px 12px", marginBottom: 12, fontSize: 10, color: tokens.red.text, borderColor: tokens.red.border, background: tokens.red.bg }}>
          {error}
          {onRetry ? <button type="button" style={{ ...quiet, marginLeft: 10 }} onClick={onRetry}>Try again</button> : null}
        </div>
      ) : null}

      {dayServices.length === 0 ? (
        <div style={{ ...box, background: tokens.tint.parchment, padding: "11px 13px", marginBottom: 12, fontSize: 11, color: tokens.ink[2], lineHeight: 1.6 }}>
          No service on {dayLabel(viewDate)} — closed, or given over to a private event. Staff can still enter a booking; guests cannot book online.
        </div>
      ) : null}

      {tab === "daybook" ? <DayBook {...context} shown={shown} counts={counts} filter={filter} onFilter={setFilter} /> : null}

      {tab === "calendar" ? (
        <CalendarTab
          month={month} onMonth={setMonth} selected={viewDate} onSelect={setViewDate}
          bookings={bookings} weeklyServices={weeklyServices} calendarRules={calendarRules} config={config}
          narrow={narrow} compact={compact}
          onOpenDay={(date) => { setViewDate(date); setTab("daybook"); }}
          onBookAt={guard((date, time, serviceName) => {
            setViewDate(date);
            if (serviceName) setService(serviceName);
            setEditing({ booking: null, prefill: { date, time, service: serviceName } });
          })}
        />
      ) : null}

      {tab === "guests" ? (
        <GuestsTab
          bookings={bookings} query={guestQuery} onQuery={setGuestQuery}
          selected={guestName} onSelect={setGuestName} narrow={narrow}
          onOpen={(booking) => { setViewDate(booking.date); setService(booking.service); setTab("daybook"); }}
        />
      ) : null}

      {tab === "waitlist" ? (
        <WaitlistTab
          entries={waitlist.filter((entry) => (entry.status || "waiting") === "waiting")}
          date={viewDate} bookings={dayBookings} config={config}
          weeklyServices={weeklyServices} calendarRules={calendarRules}
          onConvert={guard((entry, slot) => onConvertWaitlist?.({ ...entry, time: slot.time, service: slot.service, tables: slot.tables }))}
          onRemove={guard((entry, reason) => onRemoveWaitlist?.({ id: entry.id, reason }))}
        />
      ) : null}

      {tab === "timeline" ? (
        <TimelineTab
          bookings={serviceBookings} seatings={seatings} service={activeDayService}
          config={config} compact={compact} narrow={narrow}
          onDetail={(booking) => setDetail(booking)}
          onAssign={guard((booking) => setAssigning(booking))}
          onBookAt={guard((time) => setEditing({ booking: null, prefill: { date: viewDate, time, service: activeDayService?.service || service } }))}
        />
      ) : null}

      {tab === "print" ? (
        <PrintTab
          date={viewDate} service={activeDayService?.service || service} bookings={serviceBookings} compact={compact}
          onPrintKitchenTicket={onPrintKitchenTicket} onPrintBreakdown={onPrintBreakdown}
          onPrintAllergySheet={onPrintAllergySheet} onPrintWeekly={onPrintWeekly}
        />
      ) : null}

      {notice ? (
        <div style={{ marginTop: 14, padding: "9px 12px", background: tokens.green.bg, border: `1px solid ${tokens.green.border}`, color: tokens.green.text, fontSize: 10, letterSpacing: 1 }}>
          {notice}
        </div>
      ) : null}

      {editing ? (
        // ResvForm's real contract: initial / tables / reservations / excludeId /
        // onSave / onCancel / onResolveConflict / onSwapReservations. The adapter
        // below is the only translation layer — the form itself is untouched.
        <ResvForm
          initial={editing.booking
            ? bookingToLegacyReservation(editing.booking)
            : {
                date: editing.prefill?.date || viewDate,
                table_id: null,
                data: {
                  service_session: editing.prefill?.service || activeDayService?.service || service,
                  resTime: editing.prefill?.time || seatings[0] || "",
                  guests: 2,
                  lang: "en",
                  booking_status: "confirmed",
                  source: "staff",
                },
              }}
          tables={formTables}
          reservations={legacyFormReservations}
          excludeId={editing.booking?.id || null}
          onResolveConflict={onResolveConflict}
          onSwapReservations={(aId, bId) => onSwapBookings?.({ aId, bId })}
          onSave={async (draft) => {
            await onSaveBooking?.(legacyReservationToBooking(draft, {
              ...(editing.booking || {}),
              status: editing.booking?.status || "confirmed",
              source: editing.booking?.source || "staff",
            }));
            setEditing(null);
            say("Booking saved.");
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {detail ? (
        <DetailModal
          booking={detail}
          config={config}
          compact={compact}
          onEdit={() => { setEditing({ booking: detail }); setDetail(null); }}
          onAssign={() => { setAssigning(detail); setDetail(null); }}
          onStatus={guard((to, reason) => { onStatusChange?.({ id: detail.id, to, reason }); setDetail(null); })}
          onDelete={onDeleteBooking ? guard(async () => {
            if (!window.confirm(`Permanently delete ${detail.name || "this booking"}?`)) return;
            await onDeleteBooking(detail.id);
            setDetail(null);
            say("Booking removed.");
          }) : null}
          onClose={() => setDetail(null)}
        />
      ) : null}

      {walkIn ? (
        <WalkInModal
          pax={walkIn.pax}
          date={viewDate}
          service={activeDayService?.service || service}
          seatings={seatings}
          bookings={dayBookings}
          config={config}
          compact={compact}
          onPax={(pax) => setWalkIn({ pax })}
          onTake={async ({ time, tables, name }) => {
            await onSaveBooking?.({
              date: viewDate,
              service: activeDayService?.service || service,
              time, pax: walkIn.pax,
              status: "arrived",
              name: name || "Walk-in",
              source: "walk_in",
              operationalData: { tableGroup: tables },
            });
            setWalkIn(null);
            say(`Walk-in seated at ${tables.join(" + ")}.`);
          }}
          onClose={() => setWalkIn(null)}
        />
      ) : null}

      {assigning ? (
        <AssignModal
          booking={assigning}
          bookings={dayBookings}
          config={config}
          compact={compact}
          error={assignError}
          // A refused table change has to be reported inside the modal: the page's
          // error banner sits behind the overlay, so it would never be seen.
          onAssign={async (chosen) => {
            try {
              setAssignError("");
              await onAssignTables?.({ id: assigning.id, tables: chosen });
            } catch (changeError) {
              setAssignError(changeError?.message || "That table could not be assigned.");
              return;
            }
            setAssigning(null);
            say(`Table ${chosen.join(" + ")} assigned.`);
          }}
          onSwap={async (other) => {
            try {
              setAssignError("");
              await onSwapBookings?.({ aId: assigning.id, bId: other.id });
            } catch (changeError) {
              setAssignError(changeError?.message || "Those tables could not be swapped.");
              return;
            }
            setAssigning(null);
            say(`Swapped with ${other.name || "the other party"}.`);
          }}
          onClose={() => { setAssigning(null); setAssignError(""); }}
        />
      ) : null}
    </div>
  );
}

// ── Day Book ────────────────────────────────────────────────────────────────
// Planning, not service. There is no arrival or seating control here: the live
// room belongs to the Service interface.

function DayBook({ shown, counts, seatings, filter, onFilter, config, bookings, viewDate, compact, narrow, onEdit, onAssign, onStatus, onGuest, onDetail }) {
  const groups = seatings.map((time) => ({ time, list: shown.filter((booking) => booking.time === time) }));
  const offSchedule = shown.filter((booking) => !seatings.includes(booking.time));
  const filters = [
    ["all", `All ${shown.length}`],
    ["pending", `Pending ${counts.pending}`],
    ["unassigned", `No table ${counts.unassigned}`],
    ["allergy", `Allergies ${counts.allergies}`],
    ["cancelled", `Cancelled ${counts.cancelled}`],
  ];
  const stats = [["Covers", counts.covers], ["Parties", counts.parties], ["Pending", counts.pending], ["Allergies", counts.allergies], ["No table", counts.unassigned]];

  return (
    <>
      {/* Five tiles across three phone columns used to leave the sixth cell
          empty inside the box's own border, and every tile drew its right and
          bottom rule even against that border — a hollow cell ringed by
          doubled lines. The last tile now closes the row, and a tile only
          rules where another tile actually follows it. */}
      <div style={{ ...box, display: "grid", gridTemplateColumns: compact ? "repeat(3, 1fr)" : "repeat(auto-fit, minmax(104px, 1fr))", marginBottom: 12 }}>
        {stats.map(([key, value], index) => {
          const last = index === stats.length - 1;
          const endsRow = compact ? (last || index % 3 === 2) : last;
          return (
            <div key={key} style={{
              padding: "9px 12px",
              gridColumn: compact && last ? `span ${stats.length % 3 === 0 ? 1 : 3 - ((stats.length - 1) % 3)}` : undefined,
              borderRight: endsRow ? "none" : `1px solid ${tokens.ink[5]}`,
              borderBottom: compact && index < stats.length - 1 - ((stats.length - 1) % 3) ? `1px solid ${tokens.ink[5]}` : "none",
            }}>
              <div style={{ ...label9, fontSize: 8 }}>{key}</div>
              <div style={{ fontSize: compact ? 16 : 18, fontWeight: 500, marginTop: 3 }}>{value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
        {filters.map(([key, text]) => (
          <button key={key} type="button" style={pill(filter === key)} onClick={() => onFilter(key)}>{text}</button>
        ))}
      </div>

      {groups.map(({ time, list }) => (
        <div key={time} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>{time}</span>
            <span style={{ ...label9, fontSize: 8 }}>
              {list.reduce((total, booking) => total + (ACTIVE.has(booking.status) ? Number(booking.pax || 0) : 0), 0)} covers
            </span>
            <span style={{ flex: 1, borderBottom: `1px solid ${tokens.ink[5]}` }} />
          </div>
          {list.length === 0 ? (
            <div style={{ fontSize: 10, color: tokens.ink[3], padding: "3px 0" }}>Nothing booked at this seating.</div>
          ) : list.map((booking) => (
            <BookingRow key={booking.id} booking={booking} narrow={narrow} onEdit={onEdit} onAssign={onAssign} onStatus={onStatus} onGuest={onGuest} onDetail={onDetail} />
          ))}
        </div>
      ))}

      {offSchedule.length ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label9, marginBottom: 6 }}>Booked outside the current seatings</div>
          {offSchedule.map((booking) => (
            <BookingRow key={booking.id} booking={booking} narrow={narrow} onEdit={onEdit} onAssign={onAssign} onStatus={onStatus} onGuest={onGuest} onDetail={onDetail} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function BookingRow({ booking, narrow, onEdit, onAssign, onStatus, onGuest, onDetail }) {
  const ops = opsOf(booking);
  const restrictions = restrictionsOf(booking);
  const dim = !ACTIVE.has(booking.status);
  const seated = tablesOf(booking);
  const detail = restrictions.length
    ? restrictions.map(restrictionText).join(" · ")
    : ops.birthday || booking.occasion
      ? `${booking.occasion || "Birthday"}${ops.cakeNote ? ` · ${ops.cakeNote}` : ""}`
      : booking.notes || ops.notes || "—";

  return (
    <div style={{
      ...box, marginBottom: 6, padding: narrow ? "10px 11px" : "9px 12px",
      display: narrow ? "block" : "grid", gap: 10, alignItems: "center",
      gridTemplateColumns: narrow ? undefined : "minmax(130px, 1.4fr) 38px minmax(84px, 0.6fr) minmax(110px, 1fr) minmax(146px, auto)",
      borderLeft: `2px solid ${booking.status === "pending" ? tokens.signal.active : dim ? tokens.ink[5] : tokens.green.border}`,
      opacity: dim ? 0.6 : 1,
    }}>
      <div style={{ minWidth: 0, display: narrow ? "flex" : "block", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onGuest(booking)}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: FONT, fontSize: 13, color: tokens.ink[0], textAlign: "left", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {booking.name || "—"}
          </button>
          <div style={{ fontSize: 8, letterSpacing: 0.8, color: tokens.ink[3], marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {statusLabel(booking.status)}
            {ops.menuType || booking.experience ? ` · ${ops.menuType || booking.experience}` : ""}
            {booking.language || ops.lang ? ` · ${booking.language || ops.lang}` : ""}
            {(ops.rooms || (ops.room ? [ops.room] : [])).length ? ` · room ${(ops.rooms || [ops.room]).join(", ")}` : ""}
            {booking.source === "web" ? " · booked online" : ""}
            {booking.ref ? ` · ${booking.ref}` : ""}
          </div>
        </div>
        {narrow ? <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{booking.time} · {booking.pax}p</span> : null}
      </div>

      {narrow ? null : <div style={{ fontSize: 13, fontWeight: 600 }}>{booking.pax}</div>}

      <div style={narrow ? { display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" } : undefined}>
        <button type="button" style={{ ...quiet, fontWeight: 700 }} onClick={() => onAssign(booking)}>
          {seated.length ? seated.join("+") : "Assign table"}
        </button>
        {/* Record stays on every width. Cancelling with a reason, marking a
            no-show and reading the status history all live behind it, and the
            name beside it opens the guest, not the booking — so hiding it on a
            phone left a host with no way to reach any of them. */}
        <button
          type="button"
          style={narrow ? quiet : { ...quiet, marginLeft: 4 }}
          onClick={() => onDetail(booking)}
          title="Full record and history"
        >
          Record
        </button>
        {narrow ? (
          <>
            {booking.status === "pending" ? <button type="button" style={strong} onClick={() => onStatus(booking, "confirmed")}>Confirm</button> : null}
            <button type="button" style={quiet} onClick={() => onEdit(booking)}>Edit</button>
          </>
        ) : null}
      </div>

      <div style={{
        fontSize: narrow ? 10 : 9, marginTop: narrow ? 8 : 0, minWidth: 0,
        color: restrictions.length ? tokens.red.text : tokens.ink[3],
        overflow: narrow ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: narrow ? "normal" : "nowrap",
        lineHeight: narrow ? 1.6 : 1.3,
      }}>
        {detail}
      </div>

      {narrow ? null : (
        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {booking.status === "pending" ? <button type="button" style={strong} onClick={() => onStatus(booking, "confirmed")}>Confirm</button> : null}
          <button type="button" style={quiet} onClick={() => onEdit(booking)}>Edit</button>
          {ACTIVE.has(booking.status) ? (
            <button type="button" style={quiet} onClick={() => {
              const reason = window.prompt("Why is this booking cancelled?");
              if (reason && reason.trim()) onStatus(booking, "cancelled", reason.trim());
            }}>Cancel</button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

function CalendarTab({ month, onMonth, selected, onSelect, onOpenDay, onBookAt, bookings, weeklyServices, calendarRules, config, narrow, compact }) {
  const statsFor = (date) => {
    const live = bookings.filter((booking) => booking.date === date && ACTIVE.has(booking.status));
    const services = resolveServicesForDate(date, weeklyServices, calendarRules);
    const closure = calendarRules.find((rule) => rule.date === date && (rule.kind === "closed" || rule.kind === "private_event"));
    const capacity = calendarRules.find((rule) => rule.date === date && rule.kind === "capacity_override");
    const capValue = capacity?.capacity ?? capacity?.payload?.capacity ?? null;
    const covers = live.reduce((total, booking) => total + Number(booking.pax || 0), 0);
    const open = services.reduce((total, item) => total + generateSlots(item.first, item.last, item.interval)
      .filter((time) => Boolean(suggestFor({ date, time, pax: 2, bookings: live, config }))).length, 0);
    return {
      covers, open, services,
      parties: live.length,
      pending: bookings.filter((booking) => booking.date === date && booking.status === "pending").length,
      closed: services.length === 0,
      note: closure?.kind === "private_event"
        ? (closure.label || closure.payload?.label || "Private event")
        : closure ? "Closed"
        : capValue != null ? `Capacity ${capValue}`
        : "",
    };
  };

  const week = Array.from({ length: 7 }, (_, index) => shiftISO(mondayOf(selected), index));
  const cells = Array.from({ length: 42 }, (_, index) => shiftISO(mondayOf(`${month}-01`), index));
  const current = statsFor(selected);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(2, 1fr)" : narrow ? "repeat(4, 1fr)" : "repeat(7, 1fr)", gap: 5, marginBottom: 12 }}>
        {week.map((date) => {
          const stats = statsFor(date);
          const active = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => { onSelect(date); onMonth(date.slice(0, 7)); }}
              style={{
                ...box, textAlign: "left", padding: "9px 10px", cursor: "pointer", fontFamily: FONT,
                borderTop: `2px solid ${active ? tokens.charcoal.default : tokens.ink[5]}`,
                background: stats.closed ? tokens.tint.parchment : tokens.neutral[0],
              }}
            >
              <div style={{ ...label9, fontSize: 8 }}>{DAY_SHORT[dateWeekday(date)]} {Number(date.slice(8))}</div>
              <div style={{ fontSize: 20, fontWeight: 500, marginTop: 5 }}>{stats.closed ? "—" : stats.covers}</div>
              <div style={{ fontSize: 8, color: tokens.ink[3], marginTop: 4 }}>
                {stats.parties} booking{stats.parties === 1 ? "" : "s"}{stats.pending ? ` · ${stats.pending} pending` : ""}
              </div>
              <div style={{ fontSize: 8, fontWeight: 600, marginTop: 4, color: stats.closed ? tokens.ink[3] : stats.open === 0 ? tokens.signal.active : tokens.green.text }}>
                {stats.note || (stats.open === 0 ? "Fully booked" : `${stats.open} times open`)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(300px, 1fr) minmax(250px, 330px)", gap: 12, alignItems: "start" }}>
        <div style={box}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
            <span style={{ fontSize: 10, letterSpacing: 2, fontWeight: 600 }}>{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</span>
            <span style={{ display: "flex", gap: 5 }}>
              <button type="button" style={quiet} onClick={() => { const d = new Date(`${month}-15T12:00:00`); d.setMonth(d.getMonth() - 1); onMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }}>◀</button>
              <button type="button" style={quiet} onClick={() => { const d = new Date(`${month}-15T12:00:00`); d.setMonth(d.getMonth() + 1); onMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }}>▶</button>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${tokens.ink[5]}` }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day} style={{ ...label9, fontSize: 8, padding: "6px 7px" }}>{compact ? day[0] : day}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {cells.map((date) => {
              const inMonth = date.slice(0, 7) === month;
              const stats = statsFor(date);
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelect(date)}
                  title={stats.note || undefined}
                  style={{
                    minHeight: 44, padding: "5px 7px", textAlign: "left", fontFamily: FONT, cursor: "pointer",
                    border: `1px solid ${date === selected ? tokens.charcoal.default : tokens.ink[5]}`,
                    background: !inMonth ? tokens.tint.parchment : date === selected ? tokens.green.bg : tokens.neutral[0],
                    color: inMonth ? tokens.ink[0] : tokens.ink[4],
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{Number(date.slice(8))}</span>
                    {inMonth && stats.note ? (
                      <span style={{
                        width: 5, height: 5, display: "inline-block",
                        background: stats.note.startsWith("Capacity") ? tokens.red.border : stats.note === "Closed" ? tokens.ink[4] : tokens.signal.active,
                      }} />
                    ) : null}
                  </div>
                  <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 2 }}>{!inMonth || stats.closed ? "" : stats.covers || ""}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 8, letterSpacing: 0.8, color: tokens.ink[3], padding: "8px 12px", lineHeight: 1.7 }}>
            Grey dot closed · gold dot private event · red dot capacity override
          </div>
        </div>

        <div style={box}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{dayLabel(selected)} {selected.slice(0, 4)}</div>
            {current.note ? (
              <div style={{ fontSize: 9, letterSpacing: 1, fontWeight: 600, color: tokens.signal.active, marginTop: 4 }}>{current.note}</div>
            ) : null}
            <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
              {[["Covers", current.covers], ["Bookings", current.parties], ["Pending", current.pending]].map(([key, value]) => (
                <span key={key} style={{ fontSize: 9, color: tokens.ink[3] }}>{key} <strong style={{ fontSize: 12, color: tokens.ink[0] }}>{value}</strong></span>
              ))}
            </div>
            <button type="button" style={{ ...strong, marginTop: 10, width: compact ? "100%" : "auto" }} onClick={() => onOpenDay(selected)}>
              Open in Day Book
            </button>
          </div>
          <div style={{ padding: "12px 14px" }}>
            <div style={{ ...label9, marginBottom: 8 }}>Seatings — tap to book</div>
            {current.services.length === 0 ? (
              <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.6 }}>
                No service this day{current.note ? ` — ${current.note.toLowerCase()}` : ""}.
              </div>
            ) : current.services.map((item) => (
              <div key={item.service} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: 1, color: tokens.ink[2], textTransform: "uppercase", marginBottom: 5 }}>
                  {item.service} {item.first}–{item.last}
                  {item.onlineEnabled === false ? " · staff only" : ""}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {generateSlots(item.first, item.last, item.interval).map((time) => {
                    const free = Boolean(suggestFor({
                      date: selected, time, pax: 2, config,
                      bookings: bookings.filter((booking) => booking.date === selected && ACTIVE.has(booking.status)),
                    }));
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => onBookAt(selected, time, item.service)}
                        style={{ ...chip, cursor: "pointer", minHeight: 34, color: free ? tokens.ink[0] : tokens.ink[4], borderColor: free ? tokens.ink[4] : tokens.ink[5] }}
                        title={free ? "" : "No table free — staff may still overbook"}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Guests ──────────────────────────────────────────────────────────────────

function GuestsTab({ bookings, query, onQuery, selected, onSelect, onOpen, narrow }) {
  const directory = useMemo(() => {
    const map = new Map();
    bookings.forEach((booking) => {
      if (!booking.name) return;
      const key = booking.name.trim().toLowerCase();
      const entry = map.get(key) || { name: booking.name, visits: [], restrictions: new Set(), rooms: new Set(), phone: "", email: "" };
      entry.visits.push(booking);
      restrictionsOf(booking).forEach((item) => entry.restrictions.add(restrictionText(item)));
      const ops = opsOf(booking);
      (ops.rooms || (ops.room ? [ops.room] : [])).forEach((room) => entry.rooms.add(room));
      entry.phone = entry.phone || booking.phone || "";
      entry.email = entry.email || booking.email || "";
      map.set(key, entry);
    });
    return [...map.values()].map((entry) => ({
      ...entry,
      visits: entry.visits.slice().sort((a, b) => b.date.localeCompare(a.date)),
      completed: entry.visits.filter((visit) => visit.status === "completed").length,
      restrictions: [...entry.restrictions].filter(Boolean),
      rooms: [...entry.rooms],
    })).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  }, [bookings]);

  const term = query.trim().toLowerCase();
  const list = term
    ? directory.filter((entry) => `${entry.name} ${entry.phone} ${entry.email}`.toLowerCase().includes(term))
    : directory;
  const active = directory.find((entry) => entry.name === selected) || list[0] || null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(220px, 300px) minmax(280px, 1fr)", gap: 12, alignItems: "start" }}>
      <div style={box}>
        <div style={{ padding: 10, borderBottom: `1px solid ${tokens.ink[5]}` }}>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="SEARCH NAME, PHONE OR EMAIL"
            style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 1, padding: "9px 9px", width: "100%", boxSizing: "border-box", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, outline: "none", background: tokens.neutral[0], color: tokens.ink[1] }}
          />
        </div>
        <div style={{ maxHeight: narrow ? 260 : 520, overflow: "auto" }}>
          {list.slice(0, 200).map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => onSelect(entry.name)}
              style={{
                display: "block", width: "100%", textAlign: "left", fontFamily: FONT, cursor: "pointer", padding: "10px 12px",
                border: "none", borderBottom: `1px solid ${tokens.ink[5]}`,
                borderLeft: `2px solid ${active?.name === entry.name ? tokens.green.border : "transparent"}`,
                background: active?.name === entry.name ? tokens.green.bg : tokens.neutral[0],
              }}
            >
              <div style={{ fontSize: 12, color: tokens.ink[0] }}>{entry.name}</div>
              <div style={{ fontSize: 8, color: tokens.ink[3], marginTop: 2 }}>
                {entry.completed} visit{entry.completed === 1 ? "" : "s"}{entry.restrictions.length ? ` · ${entry.restrictions.join(", ")}` : ""}
              </div>
            </button>
          ))}
          {list.length === 0 ? <div style={{ padding: 12, fontSize: 10, color: tokens.ink[3] }}>No guest of that name yet.</div> : null}
        </div>
      </div>

      <div style={box}>
        {active ? (
          <>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{active.name}</div>
              <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 4, lineHeight: 1.7 }}>
                {active.completed} completed · {active.visits.length} booking{active.visits.length === 1 ? "" : "s"} on record
                {active.phone ? ` · ${active.phone}` : ""}{active.email ? ` · ${active.email}` : ""}
                {active.rooms.length ? ` · hotel room ${active.rooms.join(", ")}` : ""}
              </div>
              {active.restrictions.length ? (
                <div style={{ fontSize: 10, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "6px 8px", marginTop: 8, lineHeight: 1.6 }}>
                  Always: {active.restrictions.join(", ")}
                </div>
              ) : null}
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div style={{ ...label9, marginBottom: 8 }}>Visit history</div>
              {active.visits.map((visit) => (
                <button
                  key={visit.id}
                  type="button"
                  onClick={() => onOpen(visit)}
                  style={{ display: "block", width: "100%", textAlign: "left", fontFamily: FONT, cursor: "pointer", background: "none", border: "none", borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}
                >
                  <span style={{ fontSize: 11 }}>{dayLabel(visit.date)} {visit.date.slice(0, 4)} · {visit.time} · {visit.pax}p</span>
                  <span style={{ fontSize: 9, color: tokens.ink[3], marginLeft: 8 }}>
                    {statusLabel(visit.status)}
                    {tablesOf(visit).length ? ` · ${tablesOf(visit).join("+")}` : ""}
                    {visit.notes || opsOf(visit).notes ? ` · ${visit.notes || opsOf(visit).notes}` : ""}
                  </span>
                </button>
              ))}
            </div>
            <Suspense fallback={null}>
              {/* Archive-based history from completed services, as the old manager showed it. */}
              <GuestMemory name={active.name} />
            </Suspense>
          </>
        ) : (
          <div style={{ padding: 14, fontSize: 10, color: tokens.ink[3] }}>Choose a guest to see their history.</div>
        )}
      </div>
    </div>
  );
}

// ── Waitlist ────────────────────────────────────────────────────────────────

function WaitlistTab({ entries, date, bookings, config, weeklyServices, calendarRules, onConvert, onRemove }) {
  const live = bookings.filter((booking) => ACTIVE.has(booking.status));
  return (
    <>
      <div style={{ ...box, background: tokens.tint.parchment, padding: "11px 13px", marginBottom: 12, fontSize: 10, color: tokens.ink[2], lineHeight: 1.7 }}>
        Suggestions only. Nobody is called or messaged automatically — a person decides, then converts the entry into a booking.
      </div>
      {entries.length === 0 ? (
        <div style={{ ...box, padding: 14, fontSize: 10, color: tokens.ink[3] }}>Nobody is waiting.</div>
      ) : entries.map((entry) => {
        const entryDate = entry.date || date;
        const pax = Number(entry.pax || 2);
        // The server delivers waitlist entries as { name, time, window, … };
        // `time` is the time they asked for, `window` the range they accept.
        const requested = entry.time || null;
        const services = resolveServicesForDate(entryDate, weeklyServices, calendarRules);
        const options = services.flatMap((item) => generateSlots(item.first, item.last, item.interval)
          .map((time) => ({ time, service: item.service, fit: suggestFor({ date: entryDate, time, pax, bookings: live, config }) }))
          .filter((slot) => slot.fit));
        const best = options.find((slot) => slot.time === requested) || options[0] || null;
        return (
          <div key={entry.id} style={{ ...box, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13 }}>{entry.name || "Guest"} · {pax}p</div>
                <div style={{ fontSize: 9, color: tokens.ink[3], marginTop: 3, lineHeight: 1.6 }}>
                  {entryDate}
                  {requested ? ` · asked for ${requested}` : entry.window ? ` · ${entry.window}` : " · any time"}
                  {entry.phone ? ` · ${entry.phone}` : ""}
                  {entry.quotedMinutes ? ` · quoted ${entry.quotedMinutes} min` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {best ? (
                  <button type="button" style={strong} onClick={() => onConvert(entry, { time: best.time, service: best.service, tables: best.fit.tables })}>
                    Convert → {best.time} {best.fit.tables.join("+")}
                  </button>
                ) : null}
                <button type="button" style={quiet} onClick={() => {
                  const reason = window.prompt("Why are they coming off the waitlist?", "Guest could not make it");
                  if (reason && reason.trim()) onRemove(entry, reason.trim());
                }}>Remove</button>
              </div>
            </div>
            <div style={{ fontSize: 9, color: best ? tokens.green.text : tokens.ink[3], marginTop: 8, lineHeight: 1.6 }}>
              {best
                ? `A table fits at ${best.time}${best.fit.combined ? " — two tables joined" : ""}.`
                : "Nothing fits on this date yet. Keep them waiting, or offer another day."}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Planning & Print ────────────────────────────────────────────────────────
// The sheets themselves are produced by the app's existing generators, so the
// paper the kitchen already knows does not change.

function PrintTab({ date, service, bookings, compact, onPrintKitchenTicket, onPrintBreakdown, onPrintAllergySheet, onPrintWeekly }) {
  const live = bookings.filter((booking) => ACTIVE.has(booking.status));
  const withRestrictions = live.filter((booking) => restrictionsOf(booking).length > 0);
  // A sheet is offered only when its generator was actually passed. Filtering
  // on the wrapper instead of the handler always passed — an arrow is a
  // function whether or not the handler behind it exists — so a surface that
  // supplied no handler still showed the card, and its Print button did
  // nothing at all when pressed.
  const sheets = [
    ["Service breakdown", `${live.length} bookings · ${live.reduce((total, booking) => total + Number(booking.pax || 0), 0)} covers`, onPrintBreakdown, () => onPrintBreakdown({ date, service })],
    ["Allergy sheet", withRestrictions.length ? `${withRestrictions.length} part${withRestrictions.length === 1 ? "y" : "ies"} with restrictions` : "No restrictions this service", onPrintAllergySheet, () => onPrintAllergySheet({ date, service })],
    ["Kitchen tickets", "One ticket per party, in seating order", onPrintKitchenTicket, () => onPrintKitchenTicket({ date, service })],
    ["Week ahead", "Seven days from the selected date", onPrintWeekly, () => onPrintWeekly({ from: date })],
  ].filter(([, , handler]) => typeof handler === "function");

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginBottom: 12 }}>
        {sheets.map(([title, detail, , action]) => (
          <div key={title} style={{ ...box, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: tokens.ink[0] }}>{title}</div>
            <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.7, marginTop: 5 }}>{detail}</div>
            <button type="button" style={{ ...strong, marginTop: 10, width: compact ? "100%" : "auto" }} onClick={action}>Print</button>
          </div>
        ))}
      </div>
      {withRestrictions.length ? (
        <div style={{ ...box, padding: "12px 14px" }}>
          <div style={{ ...label9, marginBottom: 8 }}>Restrictions this service</div>
          {withRestrictions.map((booking) => (
            <div key={booking.id} style={{ fontSize: 10, borderBottom: `1px solid ${tokens.ink[5]}`, padding: "7px 0", lineHeight: 1.6 }}>
              <strong>{booking.time} · {booking.name} · {booking.pax}p{tablesOf(booking).length ? ` · ${tablesOf(booking).join("+")}` : ""}</strong>
              <span style={{ color: tokens.red.text, marginLeft: 8 }}>{restrictionsOf(booking).map(restrictionText).join(" · ")}</span>
              {hasCourseNotes(booking) ? (
                <span style={{ color: tokens.ink[3], marginLeft: 8 }}>· kitchen note on file</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── Assign / swap ───────────────────────────────────────────────────────────

function AssignModal({ booking, bookings, config, compact, error, onAssign, onSwap, onClose }) {
  const suggestion = suggestFor({ date: booking.date, time: booking.time, pax: booking.pax, bookings, config, excludeId: booking.id });
  const options = swapOptions({ booking, bookings, config });
  const hold = durationForParty(booking.pax, config);
  const current = tablesOf(booking);
  return (
    <CenteredModal onClose={onClose}>
      <div style={{ ...box, fontFamily: FONT, padding: compact ? 14 : 18, minWidth: compact ? 260 : 330 }}>
        <div style={{ ...label9, marginBottom: 10 }}>Table for {booking.name || "this party"}</div>
        <div style={{ fontSize: 11, color: tokens.ink[2], lineHeight: 1.7, marginBottom: 12 }}>
          {booking.pax} guests at {booking.time} · about {Math.round(hold / 60 * 10) / 10} h at the table
          {current.length ? ` · currently ${current.join(" + ")}` : " · no table yet"}
        </div>

        {error ? (
          <div style={{ fontSize: 10, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "7px 9px", marginBottom: 12, lineHeight: 1.6 }}>
            {error}
          </div>
        ) : null}

        {suggestion ? (
          <button type="button" style={{ ...strong, width: "100%", marginBottom: 12 }} onClick={() => onAssign(suggestion.tables)}>
            Use {suggestion.tables.join(" + ")}{suggestion.combined ? " — joined" : ""}
          </button>
        ) : (
          <div style={{ fontSize: 10, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "7px 9px", marginBottom: 12, lineHeight: 1.6 }}>
            No free table of that size at this time. {current.length ? "Swap with another party below, or change the time." : "Free a table below, or change the time."}
          </div>
        )}

        <div style={{ ...label9, marginBottom: 8 }}>All tables that fit</div>
        {options.map((option) => (
          <div key={option.table} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${tokens.ink[5]}`, padding: "8px 0" }}>
            <span style={{ fontSize: 11 }}>
              <strong>{option.table}</strong> · {option.seats} seats
              {option.occupant ? <span style={{ color: tokens.ink[3] }}> · {option.occupant.name || "booked"} {option.occupant.time}</span> : null}
            </span>
            {option.free ? (
              <button type="button" style={quiet} onClick={() => onAssign([option.table])}>Move here</button>
            ) : current.length ? (
              <button type="button" style={quiet} onClick={() => onSwap(option.occupant)}>
                Swap with {String(option.occupant.name || "party").split(",")[0]}
              </button>
            ) : (
              // A swap exchanges two tables, so a party holding none has nothing to
              // give: the server refuses it. Do not offer the action at all.
              <span style={{ fontSize: 9, color: tokens.ink[3] }}>Taken — free it, or change the time</span>
            )}
          </div>
        ))}
        <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.7, marginTop: 10 }}>
          {current.length
            ? "A swap exchanges both parties’ tables in one step, so neither is left without one."
            : "This party holds no table yet, so there is nothing to swap — take a free one, or change the time."}
        </div>
      </div>
    </CenteredModal>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
// Table by time: each booking is a duration block, so a host can see at a glance
// where a party fits. Planning only — no live NOW line, because this is not a
// service screen; the marker appears solely when the viewed day IS today.

function TimelineTab({ bookings, seatings, service, config, compact, narrow, onDetail, onAssign, onBookAt }) {
  if (!service || seatings.length === 0) {
    return <div style={{ ...box, padding: 14, fontSize: 10, color: tokens.ink[3] }}>No service this day, so there is nothing to lay out.</div>;
  }
  const buffer = Number(config.durations.buffer || 0);
  const windowStart = minutesOf(service.first);
  const lastSeating = minutesOf(seatings[seatings.length - 1]);
  const windowEnd = lastSeating + durationForParty(6, config) + buffer;
  const span = Math.max(60, windowEnd - windowStart);
  const pct = (minutes) => `${Math.max(0, Math.min(100, ((minutes - windowStart) / span) * 100))}%`;
  const ticks = [];
  for (let at = windowStart; at <= windowEnd; at += 30) ticks.push(at);

  const live = bookings.filter((booking) => ACTIVE.has(booking.status));
  const rows = config.tables.map((table) => ({
    label: String(table.id),
    seats: Number(table.seats),
    blocks: live
      .filter((booking) => tablesOf(booking).includes(String(table.id)))
      .map((booking) => {
        const start = minutesOf(booking.time);
        const hold = durationForParty(booking.pax, config);
        const lead = tablesOf(booking)[0] === String(table.id);
        return { booking, start, hold, lead, combined: tablesOf(booking).length > 1 };
      }),
  }));
  const unassigned = live.filter((booking) => tablesOf(booking).length === 0);
  const nameWidth = compact ? 74 : 116;

  return (
    <>
      <div style={{ ...box, overflowX: "auto" }}>
        <div style={{ minWidth: narrow ? 680 : "auto" }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.tint.parchment }}>
            <div style={{ width: nameWidth, flex: `0 0 ${nameWidth}px`, padding: "7px 10px", ...label9, fontSize: 8 }}>Table</div>
            <div style={{ flex: 1, position: "relative", height: 28 }}>
              {ticks.map((at) => (
                <span key={at} style={{ position: "absolute", left: pct(at), top: 8, fontSize: 8, letterSpacing: 0.6, color: tokens.ink[3], transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
                  {at % 60 === 0 ? `${pad(Math.floor(at / 60))}:00` : "·"}
                </span>
              ))}
            </div>
          </div>

          {rows.map((row) => (
            <div key={row.label} style={{ display: "flex", borderBottom: `1px solid ${tokens.ink[5]}`, minHeight: 44, alignItems: "stretch" }}>
              <div style={{ width: nameWidth, flex: `0 0 ${nameWidth}px`, padding: "0 10px", display: "flex", alignItems: "center", gap: 6, borderRight: `1px solid ${tokens.ink[5]}` }}>
                <button type="button" style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }} onClick={() => onBookAt(seatings[0])} title="Book on this table">
                  {row.label}
                </button>
                <span style={{ fontSize: 8, color: tokens.ink[3] }}>{row.seats}s</span>
              </div>
              <div style={{ flex: 1, position: "relative" }}>
                {ticks.filter((at) => at % 60 === 0).map((at) => (
                  <span key={at} style={{ position: "absolute", left: pct(at), top: 0, bottom: 0, borderLeft: `1px solid ${tokens.ink[5]}` }} />
                ))}
                {row.blocks.map(({ booking, start, hold, lead, combined }) => (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onDetail(booking)}
                    title={`${booking.name} · ${booking.pax}p · ${booking.time}`}
                    style={{
                      position: "absolute", left: pct(start), width: `calc(${pct(start + hold)} - ${pct(start)})`,
                      top: 5, bottom: 5, textAlign: "left", cursor: "pointer", overflow: "hidden", fontFamily: FONT,
                      padding: "3px 7px", background: lead ? tokens.neutral[0] : tokens.tint.parchment,
                      border: `1px solid ${booking.status === "pending" ? tokens.signal.active : tokens.ink[4]}`,
                      borderLeft: `2px solid ${booking.status === "pending" ? tokens.signal.active : tokens.green.border}`,
                    }}
                  >
                    {lead ? (
                      <>
                        <span style={{ fontSize: 9, fontWeight: 600, whiteSpace: "nowrap" }}>
                          {String(booking.name || "—").split(",")[0]} · {booking.pax}p
                        </span>
                        <span style={{ display: "block", fontSize: 8, color: restrictionsOf(booking).length ? tokens.red.text : tokens.ink[3], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {booking.time}
                          {combined ? " · joined" : ""}
                          {restrictionsOf(booking).length ? ` · ${restrictionsOf(booking).map((item) => item.note).join(", ")}` : ""}
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: 8, letterSpacing: 0.8, color: tokens.ink[3] }}>▲ joined with {tablesOf(booking)[0]}</span>
                    )}
                  </button>
                ))}
                {/* the reset gap after each party, so the next booking's start reads honestly */}
                {buffer > 0 ? row.blocks.filter((block) => block.lead).map(({ booking, start, hold }) => (
                  <span
                    key={`${booking.id}-buffer`}
                    style={{
                      position: "absolute", left: pct(start + hold), width: `calc(${pct(start + hold + buffer)} - ${pct(start + hold)})`,
                      top: 5, bottom: 5, background: tokens.tint.parchment, border: `1px dashed ${tokens.ink[5]}`, borderLeft: "none",
                    }}
                  />
                )) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 8, letterSpacing: 0.8, color: tokens.ink[3], padding: "8px 2px", lineHeight: 1.7 }}>
        Blocks are how long a party holds the table; the dashed tail is the {buffer}-minute reset before the next booking may start. Tap a block for the record, a table number to book on it.
      </div>

      {unassigned.length ? (
        <div style={{ ...box, padding: "12px 14px" }}>
          <div style={{ ...label9, marginBottom: 8 }}>Not on a table yet</div>
          {unassigned.map((booking) => (
            <div key={booking.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${tokens.ink[5]}`, padding: "7px 0" }}>
              <span style={{ fontSize: 11 }}>{booking.time} · {booking.name} · {booking.pax}p</span>
              <button type="button" style={quiet} onClick={() => onAssign(booking)}>Assign table</button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── Booking record ──────────────────────────────────────────────────────────
// Everything known about one booking, including its status history, so a host
// can answer "who changed this, and when" without leaving the workspace.

function DetailModal({ booking, config, compact, onEdit, onAssign, onStatus, onDelete, onClose }) {
  const ops = opsOf(booking);
  const restrictions = restrictionsOf(booking);
  const seated = tablesOf(booking);
  const history = booking.statusEvents || booking.status_events || [];
  const facts = [
    ["When", `${dayLabel(booking.date)} ${booking.date.slice(0, 4)} · ${booking.time} · ${booking.service}`],
    ["Party", `${booking.pax} guests · about ${Math.round(durationForParty(booking.pax, config) / 60 * 10) / 10} h at the table`],
    ["Table", seated.length ? `${seated.join(" + ")}${seated.length > 1 ? " (joined)" : ""}` : "Not assigned"],
    ["Status", statusLabel(booking.status)],
    ["Experience", ops.menuType || booking.experience || "—"],
    ["Language", booking.language || ops.lang || "—"],
    ["Contact", [booking.phone, booking.email].filter(Boolean).join(" · ") || "—"],
    ["Guest type", ops.guestType || (booking.source === "web" ? "Booked online" : booking.source === "walk_in" ? "Walk-in" : "—")],
    ["Hotel room", (ops.rooms || (ops.room ? [ops.room] : [])).join(", ") || "—"],
    ["Occasion", booking.occasion || (ops.birthday ? "Birthday" : "") || "—"],
    ["Cake", ops.cakeNote || "—"],
    ["Reference", booking.ref || "—"],
  ];
  return (
    <CenteredModal onClose={onClose}>
      <div style={{ ...box, fontFamily: FONT, padding: compact ? 14 : 18, minWidth: compact ? 260 : 360, maxWidth: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{booking.name || "Booking"}</div>
          <span style={{ ...label9, fontSize: 8 }}>{booking.source === "web" ? "booked online" : booking.source || "staff"}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: "0 16px", marginTop: 12 }}>
          {facts.map(([key, value]) => (
            <div key={key} style={{ borderBottom: `1px solid ${tokens.ink[5]}`, padding: "6px 0" }}>
              <div style={{ ...label9, fontSize: 8 }}>{key}</div>
              <div style={{ fontSize: 11, color: tokens.ink[0], marginTop: 2, lineHeight: 1.5 }}>{value}</div>
            </div>
          ))}
        </div>

        {restrictions.length ? (
          <div style={{ fontSize: 10, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "7px 9px", marginTop: 12, lineHeight: 1.7 }}>
            <strong>Kitchen must know:</strong> {restrictions.map(restrictionText).join(" · ")}
            {hasCourseNotes(booking) ? <div style={{ marginTop: 4 }}>Course notes on file.</div> : null}
          </div>
        ) : null}

        {booking.notes || ops.notes || booking.accessibility ? (
          <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.7, marginTop: 10 }}>
            {booking.notes || ops.notes}
            {booking.accessibility ? ` · access: ${booking.accessibility}` : ""}
          </div>
        ) : null}

        <div style={{ ...label9, marginTop: 14, marginBottom: 6 }}>History</div>
        {history.length === 0 ? (
          <div style={{ fontSize: 10, color: tokens.ink[3] }}>No changes recorded since this booking was made.</div>
        ) : history.map((event, index) => (
          <div key={index} style={{ fontSize: 10, borderBottom: `1px solid ${tokens.ink[5]}`, padding: "6px 0", lineHeight: 1.6 }}>
            {String(event.at || "").slice(0, 16).replace("T", " ")} · {statusLabel(event.from || event.from_status || "")} → <strong>{statusLabel(event.to || event.to_status || "")}</strong>
            {event.actor ? ` · ${event.actor}` : ""}{event.reason ? ` · ${event.reason}` : ""}
          </div>
        ))}

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" style={strong} onClick={onEdit}>Edit booking</button>
          <button type="button" style={quiet} onClick={onAssign}>{seated.length ? "Change table" : "Assign table"}</button>
          {booking.status === "pending" ? (
            <button type="button" style={quiet} onClick={() => onStatus("confirmed")}>Confirm</button>
          ) : null}
          {ACTIVE.has(booking.status) ? (
            <button type="button" style={quiet} onClick={() => {
              const reason = window.prompt("Why is this booking cancelled?");
              if (reason && reason.trim()) onStatus("cancelled", reason.trim());
            }}>Cancel</button>
          ) : null}
          {/* Only a confirmed booking may become a no-show, and like a cancellation
              it needs a reason on the record. */}
          {booking.status === "confirmed" ? (
            <button type="button" style={quiet} onClick={() => {
              const reason = window.prompt("Why is this booking a no-show?");
              if (reason && reason.trim()) onStatus("no_show", reason.trim());
            }}>No-show</button>
          ) : null}
          {onDelete ? (
            <button type="button" style={{ ...quiet, color: tokens.red.text, borderColor: tokens.red.border }} onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </CenteredModal>
  );
}

// ── Walk-in ─────────────────────────────────────────────────────────────────
// A party at the door, entered into the reservation record so the day book and
// the sheets stay complete. It does not seat anyone in Service.

function WalkInModal({ pax, date, service, seatings, bookings, config, compact, onPax, onTake, onClose }) {
  const [name, setName] = useState("");
  const options = seatings
    .map((time) => ({ time, fit: suggestFor({ date, time, pax, bookings, config }) }))
    .filter((option) => option.fit);
  const walkInsOff = config.walkIns && config.walkIns.enabled === false;

  return (
    <CenteredModal onClose={onClose}>
      <div style={{ ...box, fontFamily: FONT, padding: compact ? 14 : 18, minWidth: compact ? 260 : 330 }}>
        <div style={{ ...label9, marginBottom: 10 }}>Walk-in — {service} on {dayLabel(date)}</div>

        {walkInsOff ? (
          <div style={{ fontSize: 10, color: tokens.signal.active, lineHeight: 1.7, marginBottom: 12 }}>
            Walk-ins are switched off in settings. You can still enter this party — it will be recorded as an exception.
          </div>
        ) : null}

        <div style={{ ...label9, fontSize: 8, marginBottom: 6 }}>How many guests?</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <button type="button" style={{ ...quiet, minWidth: 44 }} onClick={() => onPax(Math.max(1, pax - 1))}>−</button>
          <span style={{ fontSize: 15, fontWeight: 600, minWidth: 34, textAlign: "center" }}>{pax}</span>
          <button type="button" style={{ ...quiet, minWidth: 44 }} onClick={() => onPax(Math.min(14, pax + 1))}>+</button>
        </div>

        <div style={{ ...label9, fontSize: 8, marginBottom: 6 }}>Name, if they gave one</div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Walk-in"
          style={{ fontFamily: FONT, fontSize: 12, padding: "9px 10px", width: "100%", boxSizing: "border-box", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, outline: "none", background: tokens.neutral[0], color: tokens.ink[1], marginBottom: 14 }}
        />

        <div style={{ ...label9, fontSize: 8, marginBottom: 6 }}>Where can they sit?</div>
        {options.length === 0 ? (
          <div style={{ fontSize: 10, color: tokens.red.text, background: tokens.red.bg, border: `1px solid ${tokens.red.border}`, padding: "7px 9px", lineHeight: 1.6 }}>
            Nothing fits {pax} guests today. Offer the waitlist instead.
          </div>
        ) : options.map((option) => (
          <button
            key={option.time}
            type="button"
            style={{ ...quiet, display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 5, textAlign: "left" }}
            onClick={() => onTake({ time: option.time, tables: option.fit.tables, name: name.trim() })}
          >
            <span style={{ fontWeight: 600 }}>{option.time}</span>
            <span style={{ color: tokens.ink[3] }}>{option.fit.tables.join(" + ")}{option.fit.combined ? " joined" : ""}</span>
          </button>
        ))}
      </div>
    </CenteredModal>
  );
}
