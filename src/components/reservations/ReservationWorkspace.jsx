// ReservationWorkspace — the reservation system's staff surface.
//
// CANONICAL SOURCE: reservation_bookings, handed to this component as the flat
// booking UI model. Nothing here reads or writes the legacy `reservations`
// shape; that shape survives only as a read-compatibility adapter for the
// existing Service interface, which is not this component's business. Nothing
// here touches Service, Floor, Kitchen, KDS, service_tables or service_settings.
//
// Every legacy operational field travels untouched inside operationalData
// (menuType, lang, guestType, room/rooms, birthday, cakeNote, restrictions with
// course positions, notes, tableGroup, courseOverrides, kitchenCourseNotes), so
// the kitchen ticket, service breakdown, weekly overview and allergy sheet keep
// working exactly as they do today.
//
// The browser is never the authority for availability — the server decides.
// The engine is consulted here only to choose what to show a host.
//
// Booking UI model:
//   { id, date, service, time, pax, status, name, phone, email, language,
//     source, ref, tableLabel, experience, occasion, notes, allergies,
//     accessibility, consentNews, operationalData }

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { BP, useIsMobile } from "../../hooks/useIsMobile.js";
import CenteredModal from "../ui/CenteredModal.jsx";
import { durationForParty, normalizeReservationConfig } from "../../domain/reservations/config.js";
import { generateSlots, resolveServicesForDate, walkInsAllowed } from "../../domain/reservations/availability.js";
import { canTransitionReservation, statusLabel } from "../../domain/reservations/lifecycle.js";
import {
  activeLegacyReservations,
  bookingToLegacyReservation,
  legacyReservationToBooking,
  tableLabelToId,
} from "../../domain/reservations/bookingAdapter.js";
import AssignPanel from "./workspace/AssignPanel.jsx";
import CalendarTab from "./workspace/CalendarTab.jsx";
import ConfirmDialog from "./workspace/ConfirmDialog.jsx";
import DayBook from "./workspace/DayBook.jsx";
import GuestsTab from "./workspace/GuestsTab.jsx";
import PlanningPrint from "./workspace/PlanningPrint.jsx";
import RecordPanel from "./workspace/RecordPanel.jsx";
import TimelineGrid from "./workspace/TimelineGrid.jsx";
import WaitlistTab from "./workspace/WaitlistTab.jsx";
import WalkInPanel from "./workspace/WalkInPanel.jsx";
import {
  FONT,
  chipStyle,
  coversOf,
  darkButton,
  dayLabel,
  isActiveBooking,
  quietButton,
  restrictionFlags,
  shiftISO,
  tablesOfBooking,
  todayISO,
} from "./workspace/shared.js";

const ResvForm = lazy(() => import("./ResvForm.jsx"));

const TABS = [
  ["daybook", "Day Book", "Day"],
  ["timeline", "Timeline", "Time"],
  ["calendar", "Calendar", "Cal"],
  ["guests", "Guests", "Guests"],
  ["waitlist", "Waitlist", "Wait"],
  ["print", "Planning & Print", "Print"],
];

const CLOSED_STATUSES = new Set(["cancelled", "no_show", "completed"]);

/** A blank legacy row for ResvForm, so a new booking starts on the right date. */
const blankLegacy = (date, service, time, tableIds) => ({
  id: null,
  date,
  table_id: tableIds?.[0] ?? null,
  data: {
    reservation_v2: true,
    booking_status: "confirmed",
    service_session: service,
    resTime: time || "",
    guests: 2,
    resName: "",
    restrictions: [],
    tableGroup: tableIds || [],
  },
});

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
  onStatusChange,
  onAssignTables,
  onSwapBookings,
  onResolveConflict,
  onConvertWaitlist,
  onRemoveWaitlist,
  onMergeGuests,
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
  const isMobile = useIsMobile(BP.md);
  const isTablet = useIsMobile(BP.lg);
  const config = useMemo(() => normalizeReservationConfig(reservationConfig), [reservationConfig]);

  const [tab, setTab] = useState("daybook");
  const [viewDate, setViewDate] = useState(serviceDate || todayISO());
  const [service, setService] = useState(activeService);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [calendarDate, setCalendarDate] = useState(serviceDate || todayISO());
  const [calendarMonth, setCalendarMonth] = useState((serviceDate || todayISO()).slice(0, 7));
  const [guestQuery, setGuestQuery] = useState("");
  const [guestName, setGuestName] = useState("");

  const [composer, setComposer] = useState(null); // { legacy, existing }
  const [recordOf, setRecordOf] = useState(null);
  const [assignOf, setAssignOf] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (serviceDate) setViewDate(serviceDate);
  }, [serviceDate]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const dayServices = useMemo(
    () => resolveServicesForDate(viewDate, weeklyServices, calendarRules),
    [viewDate, weeklyServices, calendarRules],
  );

  // Keep the selected service on something this date actually offers, so the
  // header can never point at a service the weekday does not serve.
  const currentService = useMemo(() => {
    if (dayServices.some((item) => item.service === service)) return service;
    return dayServices[0]?.service || service;
  }, [dayServices, service]);

  const dayBookings = useMemo(() => bookings.filter((booking) => booking.date === viewDate), [bookings, viewDate]);

  const serviceBookings = useMemo(
    () => dayBookings.filter((booking) => (booking.service || "dinner") === currentService),
    [dayBookings, currentService],
  );

  const counts = useMemo(() => {
    const active = serviceBookings.filter(isActiveBooking);
    return {
      all: active.length,
      pending: serviceBookings.filter((booking) => booking.status === "pending").length,
      confirmed: serviceBookings.filter((booking) => booking.status === "confirmed").length,
      allergy: active.filter((booking) => restrictionFlags(booking).length > 0).length,
      hotel: active.filter((booking) => booking.operationalData?.guestType === "hotel").length,
      notable: active.filter((booking) => tablesOfBooking(booking).length === 0).length,
      closed: serviceBookings.filter((booking) => CLOSED_STATUSES.has(booking.status)).length,
    };
  }, [serviceBookings]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return serviceBookings
      .filter((booking) => {
        switch (filter) {
          case "pending":
            return booking.status === "pending";
          case "confirmed":
            return booking.status === "confirmed";
          case "allergy":
            return isActiveBooking(booking) && restrictionFlags(booking).length > 0;
          case "hotel":
            return isActiveBooking(booking) && booking.operationalData?.guestType === "hotel";
          case "notable":
            return isActiveBooking(booking) && tablesOfBooking(booking).length === 0;
          case "closed":
            return CLOSED_STATUSES.has(booking.status);
          default:
            return isActiveBooking(booking);
        }
      })
      .filter((booking) => {
        if (!needle) return true;
        return [
          booking.name,
          booking.phone,
          booking.email,
          booking.ref,
          tablesOfBooking(booking).join(" "),
          (booking.operationalData?.rooms || []).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [serviceBookings, filter, query]);

  /* ── mutations ─────────────────────────────────────────────────────────── */

  /** Every write reports its own failure. A host must never believe a change
   *  landed when the server refused it. */
  const runAction = useCallback(async (action, successMessage) => {
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (actionError) {
      setNotice(actionError?.message || "That change could not be saved.");
      return false;
    }
  }, []);

  const transition = useCallback(
    (booking, next) => {
      if (!canTransitionReservation(booking.status, next)) {
        setNotice(`${statusLabel(booking.status)} cannot become ${statusLabel(next)}.`);
        return;
      }
      const destructive = next === "cancelled" || next === "no_show";
      if (!destructive) {
        runAction(() => onStatusChange({ id: booking.id, to: next }), `${booking.name} → ${statusLabel(next)}`);
        return;
      }
      setPrompt({
        title: next === "cancelled" ? "Cancel reservation" : "Mark no-show",
        message: `${booking.name} · ${booking.time} · ${booking.pax} covers. This is recorded with a reason and can be reinstated from the record.`,
        needsReason: true,
        reason: "",
        confirmLabel: next === "cancelled" ? "Cancel booking" : "No-show",
        onConfirm: (reason) =>
          runAction(() => onStatusChange({ id: booking.id, to: next, reason }), `${booking.name} → ${statusLabel(next)}`),
      });
    },
    [onStatusChange, runAction],
  );

  const openComposer = useCallback((booking) => {
    setRecordOf(null);
    setComposer({ legacy: bookingToLegacyReservation(booking), existing: booking });
  }, []);

  const openNewBooking = useCallback(
    (date = viewDate, forService = currentService, time = "", tableLabels = []) => {
      const ids = tableLabels.map(tableLabelToId).filter(Boolean);
      setComposer({ legacy: blankLegacy(date, forService, time, ids), existing: null });
    },
    [viewDate, currentService],
  );

  const duplicateBooking = useCallback((booking) => {
    setRecordOf(null);
    const legacy = bookingToLegacyReservation(booking);
    setComposer({
      legacy: {
        ...legacy,
        id: null,
        table_id: null,
        data: { ...legacy.data, tableGroup: [], resTime: "", booking_status: "pending" },
      },
      existing: null,
    });
  }, []);

  const saveFromForm = useCallback(
    async (row) => {
      const booking = legacyReservationToBooking(row, composer?.existing || {});
      const saved = await runAction(() => onSaveBooking(booking), composer?.existing ? "Booking updated" : "Booking saved");
      if (saved) setComposer(null);
    },
    [composer, onSaveBooking, runAction],
  );

  const convertWaitlist = useCallback(
    (entry, suggestion) => {
      if (onConvertWaitlist) {
        // convertWaitlist builds the booking from this entry, so it must carry
        // the evening the guest actually asked for — not the date being viewed.
        runAction(
          () =>
            onConvertWaitlist({
              ...entry,
              service: entry.service || currentService,
              time: entry.time || "",
              tables: suggestion?.tables || [],
            }),
          `${entry.name} converted`,
        );
        return;
      }
      // No conversion handler wired: fall back to the composer, pre-filled, so
      // the party is still never retyped.
      const ids = (suggestion?.tables || []).map(tableLabelToId).filter(Boolean);
      const legacy = blankLegacy(entry.date || viewDate, entry.service || currentService, entry.time || "", ids);
      setComposer({
        legacy: {
          ...legacy,
          data: {
            ...legacy.data,
            resName: entry.name,
            guests: entry.pax,
            phone: entry.phone || "",
            restrictions: entry.restrictions || [],
            email: entry.email || "",
            notes: entry.notes || "",
          },
        },
        existing: null,
      });
    },
    [onConvertWaitlist, runAction, viewDate, currentService],
  );

  const removeWaitlist = useCallback(
    (entry) => {
      setPrompt({
        title: "Remove from waitlist",
        message: `${entry.name} · ${entry.pax} covers. Removal is recorded with a reason.`,
        needsReason: true,
        reason: "",
        confirmLabel: "Remove",
        onConfirm: (reason) => runAction(() => onRemoveWaitlist({ id: entry.id, reason }), `${entry.name} removed`),
      });
    },
    [onRemoveWaitlist, runAction],
  );

  const recordWalkIn = useCallback(
    async (entry) => {
      const booking = {
        id: null,
        date: entry.date,
        service: entry.service,
        time: entry.time,
        pax: entry.pax,
        status: "arrived",
        name: entry.name,
        source: "walkin",
        tableLabel: entry.tables[0],
        operationalData: { tableGroup: entry.tables, restrictions: [] },
      };
      const saved = await runAction(() => onSaveBooking(booking), `${entry.name} recorded on ${entry.tables.join("+")}`);
      if (saved) setWalkIn(false);
    },
    [onSaveBooking, runAction],
  );

  /* ── chrome ────────────────────────────────────────────────────────────── */

  const activeCovers = coversOf(serviceBookings.filter(isActiveBooking));
  const dayCovers = coversOf(dayBookings.filter(isActiveBooking));
  const serviceDef = dayServices.find((item) => item.service === currentService);
  const seatings = serviceDef ? generateSlots(serviceDef.first, serviceDef.last, serviceDef.interval) : [];
  const canWalkIn = canEdit && walkInsAllowed({ date: viewDate, services: weeklyServices, exceptions: calendarRules, config });

  if (loading) {
    return (
      <Shell onExit={onExit}>
        <div style={{ textAlign: "center", padding: "80px 0", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[3] }}>
          Loading reservations…
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell onExit={onExit}>
        <div style={{ textAlign: "center", padding: "70px 16px" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.red.text, fontWeight: 600 }}>
            Reservations could not be loaded
          </div>
          <div style={{ fontSize: 10, color: tokens.ink[2], lineHeight: 1.8, maxWidth: 420, margin: "10px auto 0" }}>{error}</div>
          {onRetry && (
            <button type="button" style={{ ...darkButton, marginTop: 16 }} onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell onExit={onExit}>
      <div style={{ display: "flex", alignItems: "stretch", background: tokens.neutral[0], borderBottom: `1px solid ${tokens.ink[4]}`, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRight: isMobile ? "none" : `1px solid ${tokens.ink[5]}`, flexWrap: "wrap" }}>
          <button type="button" style={quietButton} onClick={() => setViewDate(shiftISO(viewDate, -1))}>
            ◀
          </button>
          <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3] }}>
              Date ·{" "}
              <span style={{ color: tokens.signal.active }}>
                {viewDate === todayISO() ? "Today" : viewDate < todayISO() ? "Past" : "Planning"}
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.04em", color: tokens.ink[0], marginTop: 2 }}>
              {dayLabel(viewDate)} {viewDate.slice(0, 4)}
            </div>
          </div>
          <button type="button" style={quietButton} onClick={() => setViewDate(shiftISO(viewDate, 1))}>
            ▶
          </button>
          <button type="button" style={quietButton} onClick={() => setViewDate(todayISO())}>
            Today
          </button>
          <div style={{ display: "flex", marginLeft: 6 }}>
            {dayServices.map((item) => (
              <button
                key={item.service}
                type="button"
                style={chipStyle(currentService === item.service, { pad: "8px 14px", touch: true })}
                onClick={() => setService(item.service)}
              >
                {item.service}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "repeat(3,1fr)" : "repeat(6,1fr)", minWidth: isMobile ? "100%" : 420 }}>
          <Stat label="Covers" value={activeCovers} />
          <Stat label="Parties" value={serviceBookings.filter(isActiveBooking).length} />
          <Stat label="Pending" value={counts.pending} color={counts.pending ? tokens.signal.warn : undefined} />
          <Stat label="Allergy" value={counts.allergy} color={counts.allergy ? tokens.signal.alert : undefined} />
          <Stat label="No table" value={counts.notable} color={counts.notable ? tokens.signal.warn : undefined} />
          <Stat label="Day covers" value={dayCovers} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px", background: tokens.neutral[0], borderBottom: `1px solid ${tokens.ink[4]}`, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {TABS.map(([key, full, short]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                fontSize: 8,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                fontWeight: tab === key ? 600 : 400,
                padding: "8px 11px",
                minHeight: 34,
                border: `1px solid ${tab === key ? tokens.charcoal.default : tokens.ink[4]}`,
                background: tab === key ? tokens.charcoal.default : tokens.neutral[0],
                color: tab === key ? tokens.neutral[0] : tokens.ink[2],
                marginLeft: -1,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {isMobile ? short : full}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search guest / phone / table / room"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              border: `1px solid ${tokens.ink[4]}`,
              background: tokens.neutral[0],
              color: tokens.ink[1],
              padding: "8px 10px",
              minHeight: 34,
              flex: "1 1 140px",
              minWidth: 120,
              maxWidth: 260,
              outline: "none",
              fontFamily: FONT,
              borderRadius: 0,
            }}
          />
          {canWalkIn && (
            <button type="button" style={quietButton} onClick={() => setWalkIn(true)}>
              Walk-in
            </button>
          )}
          {canEdit && (
            <button type="button" style={darkButton} onClick={() => openNewBooking()}>
              [+] New booking
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? "14px 12px 40px" : "16px 16px 48px" }}>
        {dayServices.length === 0 && tab !== "calendar" && tab !== "guests" && (
          <div style={{ border: `1px solid ${tokens.signal.warn}`, background: tokens.neutral[0], padding: "12px 14px", marginBottom: 14, fontSize: 10, color: tokens.ink[2], lineHeight: 1.7 }}>
            No service on {dayLabel(viewDate)} — closed, or given over to a private event. Staff can still enter a booking; guests cannot book online.
          </div>
        )}

        {tab === "daybook" && (
          <DayBook
            shown={shown}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            config={config}
            isMobile={isMobile}
            canEdit={canEdit}
            onOpen={setRecordOf}
            onConfirm={(booking) => transition(booking, "confirmed")}
            onAssign={setAssignOf}
            emptyLabel={query ? `No matches for “${query}”` : `No ${filter === "all" ? "" : `${filter} `}reservations — ${currentService}`}
          />
        )}

        {tab === "timeline" && serviceDef && (
          <>
            <div style={{ fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 10 }}>
              Expected arrivals and booking capacity — not live service · turn buffer {config.durations.buffer} min
            </div>
            <TimelineGrid
              date={viewDate}
              service={serviceDef}
              bookings={bookings}
              config={config}
              onOpen={setRecordOf}
              onBookGap={canEdit ? (date, svc, time, table) => openNewBooking(date, svc, time, [table]) : null}
            />
          </>
        )}

        {tab === "timeline" && !serviceDef && (
          <div style={{ fontSize: 10, letterSpacing: "0.06em", color: tokens.ink[3] }}>No service on this date — nothing to lay out.</div>
        )}

        {tab === "calendar" && (
          <CalendarTab
            selectedDate={calendarDate}
            onSelectDate={(date) => {
              setCalendarDate(date);
              setCalendarMonth(date.slice(0, 7));
            }}
            month={calendarMonth}
            onMonth={setCalendarMonth}
            bookings={bookings}
            weeklyServices={weeklyServices}
            calendarRules={calendarRules}
            config={config}
            isMobile={isTablet}
            onOpenDay={(date) => {
              setViewDate(date);
              setTab("daybook");
            }}
            onNewBooking={(date, svc, time) => {
              if (canEdit) openNewBooking(date, svc || currentService, time || "");
            }}
          />
        )}

        {tab === "guests" && (
          <GuestsTab
            bookings={bookings}
            query={guestQuery}
            onQuery={setGuestQuery}
            selectedName={guestName}
            onSelect={setGuestName}
            canEdit={canEdit}
            isMobile={isTablet}
            onMergeGuests={onMergeGuests ? (payload) => runAction(() => onMergeGuests(payload), "Profiles merged") : null}
            onBookFor={(guest) => {
              const legacy = blankLegacy(viewDate, currentService, "", []);
              setComposer({
                legacy: {
                  ...legacy,
                  data: { ...legacy.data, resName: guest.name, phone: guest.phone, email: guest.email, lang: guest.language },
                },
                existing: null,
              });
            }}
          />
        )}

        {tab === "waitlist" && (
          <WaitlistTab
            waitlist={waitlist}
            bookings={bookings}
            config={config}
            canEdit={canEdit}
            isMobile={isTablet}
            onConvert={convertWaitlist}
            onRemove={removeWaitlist}
          />
        )}

        {tab === "print" && (
          <PlanningPrint
            date={viewDate}
            service={currentService}
            dayBookings={serviceBookings.filter(isActiveBooking)}
            onPrintBreakdown={onPrintBreakdown}
            onPrintAllergySheet={onPrintAllergySheet}
            onPrintKitchenTicket={onPrintKitchenTicket}
            onPrintWeekly={onPrintWeekly}
          />
        )}

        {tab === "daybook" && seatings.length > 0 && (
          <div style={{ marginTop: 20, fontSize: 8, letterSpacing: "0.08em", color: tokens.ink[3], textTransform: "uppercase" }}>
            {currentService} seatings: {seatings.join(" · ")} · turn {durationForParty(2, config)}–{durationForParty(8, config)} min + {config.durations.buffer} buffer
          </div>
        )}
      </div>

      {composer && (
        <CenteredModal onClose={() => setComposer(null)} maxWidth={960} label={composer.existing ? "Edit reservation" : "New reservation"}>
          <Suspense fallback={<div style={{ background: tokens.neutral[0], padding: 20, fontFamily: FONT, fontSize: 10 }}>Loading form…</div>}>
            <ResvForm
              initial={composer.legacy}
              tables={tables}
              reservations={activeLegacyReservations(bookings.filter((booking) => booking.date === composer.legacy.date))}
              excludeId={composer.legacy.id}
              onSave={saveFromForm}
              onCancel={() => setComposer(null)}
              onResolveConflict={onResolveConflict}
              onSwapReservations={onSwapBookings}
            />
          </Suspense>
        </CenteredModal>
      )}

      {recordOf && (
        <RecordPanel
          booking={recordOf}
          config={config}
          canEdit={canEdit}
          statusEvents={recordOf.statusEvents || recordOf.status_events}
          onClose={() => setRecordOf(null)}
          onTransition={(booking, next) => {
            setRecordOf(null);
            transition(booking, next);
          }}
          onEdit={openComposer}
          onDuplicate={duplicateBooking}
        />
      )}

      {assignOf && (
        <AssignPanel
          booking={assignOf}
          bookings={bookings}
          config={config}
          onClose={() => setAssignOf(null)}
          onAssign={async (booking, tableLabels) => {
            const saved = await runAction(
              () => onAssignTables({ id: booking.id, tables: tableLabels }),
              `${booking.name} → ${tableLabels.join("+")}`,
            );
            if (saved) setAssignOf(null);
          }}
          onSwap={(a, b) => runAction(() => onSwapBookings({ aId: a.id, bId: b.id }), `${a.name} ↔ ${b.name}`)}
          onMove={(booking, table) => runAction(() => onAssignTables({ id: booking.id, tables: [table] }), `${booking.name} moved to ${table}`)}
          onOverride={(booking, table, reason) =>
            runAction(() => onAssignTables({ id: booking.id, tables: [table], override: true, reason }), `Override recorded — ${reason}`)
          }
        />
      )}

      {walkIn && (
        <WalkInPanel
          date={viewDate}
          services={dayServices}
          bookings={bookings}
          config={config}
          onClose={() => setWalkIn(false)}
          onRecord={recordWalkIn}
        />
      )}

      <ConfirmDialog
        prompt={prompt}
        onReason={(reason) => setPrompt((current) => ({ ...current, reason, error: "" }))}
        onCancel={() => setPrompt(null)}
        onConfirm={() => {
          if (!prompt) return;
          const reason = String(prompt.reason || "").trim();
          if (prompt.needsReason && !reason) {
            setPrompt((current) => ({ ...current, error: "A reason is required." }));
            return;
          }
          const run = prompt.onConfirm;
          setPrompt(null);
          run(reason);
        }}
      />

      {notice && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 2200,
            background: tokens.charcoal.default,
            color: tokens.neutral[0],
            padding: "10px 14px",
            fontSize: 9,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            fontFamily: FONT,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          {notice}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, onExit }) {
  return (
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, color: tokens.ink[1] }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 16px", background: tokens.neutral[0], borderBottom: `1px solid ${tokens.ink[4]}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.28em", color: tokens.ink[0] }}>MILKA</span>
          <span style={{ fontSize: 9, letterSpacing: "0.14em", color: tokens.ink[3] }}>[RESERVATIONS]</span>
        </div>
        {onExit && (
          <button type="button" style={quietButton} onClick={onExit}>
            Close
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: "9px 14px", borderRight: `1px solid ${tokens.ink[5]}` }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500, color: color || tokens.ink[0], marginTop: 3 }}>{value}</div>
    </div>
  );
}
