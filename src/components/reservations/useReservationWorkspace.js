import { useCallback, useEffect, useMemo, useState } from "react";
import { RESTRICTIONS } from "../../constants/dietary.js";
import {
  bookingToLegacyReservation,
  tableIdToLabel,
} from "../../domain/reservations/bookingAdapter.js";
import {
  generateKitchenTicketsHTML,
  generateWeeklyAllergyHTML,
  generateWeeklyReservationsHTML,
} from "../../utils/weeklyPrintGenerator.js";
import { randomUuid } from "../../utils/uuid.js";
import {
  loadStaffState,
  staffAction,
} from "../../reservations-lab/reservationClient.js";

function eventForUi(event) {
  return {
    ...event,
    at: event.occurred_at || event.at,
    from: event.from_status || event.from,
    to: event.to_status || event.to,
  };
}

function attachStatusEvents(bookings, events) {
  const byBooking = new Map();
  (events || []).forEach((event) => {
    const key = String(event.booking_id || event.bookingId || "");
    if (!key) return;
    if (!byBooking.has(key)) byBooking.set(key, []);
    byBooking.get(key).push(eventForUi(event));
  });
  return (bookings || []).map((booking) => ({
    ...booking,
    statusEvents: byBooking.get(String(booking.id)) || [],
  }));
}

function printHtml(html) {
  const popup = window.open("", "_blank", "width=1000,height=760");
  if (!popup) {
    window.alert("Printing was blocked. Allow pop-ups for Milka and try again.");
    return;
  }
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 500);
}

function dateRange(from, days = 7) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(`${from}T12:00:00`);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function activeForPrint(bookings, { date, service, from, to } = {}) {
  return (bookings || [])
    .filter((booking) => !["cancelled", "no_show"].includes(booking.status))
    .filter((booking) => !date || booking.date === date)
    .filter((booking) => !service || booking.service === service)
    .filter((booking) => !from || booking.date >= from)
    .filter((booking) => !to || booking.date <= to)
    .map(bookingToLegacyReservation);
}

export function useReservationWorkspace({
  enabled,
  accessToken,
  workspaceId,
  menuCourses = [],
  profiles = [],
  assignments = {},
}) {
  const credentials = useMemo(() => ({ accessToken, workspaceId }), [accessToken, workspaceId]);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled || !accessToken || !workspaceId) return null;
    setLoading(true);
    try {
      const payload = await loadStaffState(credentials);
      setState(payload.state);
      setError("");
      return payload.state;
    } catch (requestError) {
      setError(requestError.message || "Reservations could not be loaded.");
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [accessToken, credentials, enabled, workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    refresh().catch(() => {});
  }, [enabled, refresh]);

  const mutate = useCallback(async (action, body) => {
    try {
      const result = await staffAction(action, body, credentials);
      await refresh();
      return result;
    } catch (requestError) {
      setError(requestError.message || "Reservation change failed.");
      throw requestError;
    }
  }, [credentials, refresh]);

  const bookings = useMemo(
    () => attachStatusEvents(state?.bookings, state?.events),
    [state?.bookings, state?.events],
  );

  const onSaveBooking = useCallback((booking) => (
    booking.id
      ? mutate("updateBooking", { booking })
      : mutate("createBooking", {
          booking: {
            ...booking,
            idempotencyKey: booking.idempotencyKey || randomUuid(),
          },
        })
  ), [mutate]);

  const onDeleteBooking = useCallback(
    (id) => mutate("deleteBooking", { bookingId: id }),
    [mutate],
  );
  const onStatusChange = useCallback(
    ({ id, to, reason }) => mutate("transition", { bookingId: id, toStatus: to, reason }),
    [mutate],
  );
  const onAssignTables = useCallback(
    ({ id, tables }) => mutate("assignTables", { bookingId: id, tables }),
    [mutate],
  );
  const onSwapBookings = useCallback(
    ({ aId, bId }) => mutate("swapTables", { aId, bId }),
    [mutate],
  );
  const onResolveConflict = useCallback(
    (bookingId, tableId) => mutate("assignTables", {
      bookingId,
      tables: [tableIdToLabel(tableId)],
    }),
    [mutate],
  );
  const onConvertWaitlist = useCallback(
    (entry) => mutate("convertWaitlist", {
      waitlistId: entry.id,
      booking: {
        date: entry.date,
        service: entry.service,
        time: entry.time,
        pax: Number(entry.pax),
        name: entry.name,
        phone: entry.phone || "",
        email: entry.email || "",
        source: "waitlist",
        status: "confirmed",
        tableLabel: entry.tables?.[0] || null,
        operationalData: { tableGroup: entry.tables || [] },
        notes: entry.notes || "",
        idempotencyKey: `waitlist:${entry.id}`,
      },
    }),
    [mutate],
  );
  const onRemoveWaitlist = useCallback(
    ({ id, reason }) => mutate("updateWaitlist", {
      id,
      patch: { status: "removed", removedReason: reason },
    }),
    [mutate],
  );

  const onPrintKitchenTicket = useCallback(({ date, service }) => {
    const rows = activeForPrint(bookings, { date, service });
    printHtml(generateKitchenTicketsHTML(rows, menuCourses, RESTRICTIONS, profiles, assignments));
  }, [assignments, bookings, menuCourses, profiles]);

  const onPrintBreakdown = useCallback(({ date, service }) => {
    const rows = activeForPrint(bookings, { date, service });
    printHtml(generateWeeklyReservationsHTML(rows, dateRange(date, 1), RESTRICTIONS));
  }, [bookings]);

  const onPrintAllergySheet = useCallback(({ date, service }) => {
    const rows = activeForPrint(bookings, { date, service });
    printHtml(generateWeeklyAllergyHTML(rows, menuCourses, dateRange(date, 1), RESTRICTIONS, profiles, assignments));
  }, [assignments, bookings, menuCourses, profiles]);

  const onPrintWeekly = useCallback(({ from }) => {
    const dates = dateRange(from, 7);
    const to = dates[6].toISOString().slice(0, 10);
    const rows = activeForPrint(bookings, { from, to });
    printHtml(generateWeeklyReservationsHTML(rows, dates, RESTRICTIONS));
  }, [bookings]);

  return {
    loading,
    error,
    retry: refresh,
    bookings,
    reservationConfig: state?.config,
    weeklyServices: state?.services || [],
    calendarRules: state?.exceptions || [],
    waitlist: state?.waitlist || [],
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
  };
}
