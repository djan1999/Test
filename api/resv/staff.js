import {
  assertStaffAccess,
  createBooking,
  getAdminClient,
  getWorkspace,
  loadReservationContext,
  mapBooking,
  mapException,
  methodNotAllowed,
  sendJson,
  transitionBooking,
  validateBookingPayload,
} from "./_shared.js";
import { normalizeReservationConfig } from "../../src/domain/reservations/config.js";
import { legacyReservationToBooking } from "../../src/domain/reservations/bookingAdapter.js";

async function loadState(client, workspaceId) {
  const context = await loadReservationContext(client, workspaceId);
  const [waitlist, guests, events, audit] = await Promise.all([
    client.from("reservation_waitlist").select("*").eq("workspace_id", workspaceId).order("created_at"),
    client.from("reservation_guests").select("*").eq("workspace_id", workspaceId).is("merged_into", null).order("name"),
    client.from("reservation_status_events").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(300),
    client.from("reservation_admin_audit").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(200),
  ]);
  for (const result of [waitlist, guests, events, audit]) if (result.error) throw result.error;
  return {
    ...context,
    waitlist: (waitlist.data || []).map((entry) => ({
      id: entry.id,
      date: entry.date,
      service: entry.service,
      time: entry.requested_time ? String(entry.requested_time).slice(0, 5) : "",
      window: entry.time_window || "",
      name: entry.guest_name,
      phone: entry.phone || "",
      email: entry.email || "",
      pax: Number(entry.pax),
      quotedMinutes: entry.quoted_minutes,
      notes: entry.notes || "",
      status: entry.status,
      createdAt: entry.created_at,
    })),
    guests: guests.data || [],
    events: events.data || [],
    audit: audit.data || [],
  };
}

export default async function handler(request, response) {
  try {
    const client = getAdminClient();
    const workspace = await getWorkspace(client);
    if (request.method === "GET") {
      await assertStaffAccess(request, client);
      return sendJson(response, 200, { ok: true, workspace, state: await loadState(client, workspace.id) });
    }
    if (request.method !== "POST") return methodNotAllowed(response);

    const action = String(request.body?.action || "");
    const adminActions = new Set([
      "saveConfig", "saveAdminSettings", "saveSchedule", "saveServices",
      "saveCalendarRule", "saveCalendarRules", "deleteCalendarRule",
    ]);
    const access = await assertStaffAccess(request, client, {
      adminOnly: adminActions.has(action),
    });
    const actor = access.userId ? `MILKA:${access.userId}` : "LAB STAFF";
    if (action === "staffState") {
      return sendJson(response, 200, { ok: true, workspace, state: await loadState(client, workspace.id) });
    }
    if (action === "createBooking") {
      const result = await createBooking(client, workspace.id, {
        ...request.body.booking,
        source: request.body.booking?.source || "staff",
        actor,
      });
      return sendJson(response, 200, { ok: true, booking: result.booking });
    }
    if (action === "updateBooking") {
      const booking = request.body.booking || {};
      validateBookingPayload(booking);
      const { data: before, error: beforeError } = await client
        .from("reservation_bookings")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("id", booking.id)
        .single();
      if (beforeError) throw beforeError;
      const merged = {
        ...mapBooking(before),
        ...booking,
        id: before.id,
        status: booking.status || before.status,
        operationalData: {
          ...(before.operational_data || {}),
          ...(booking.operationalData || {}),
        },
      };
      const { data: savedRows, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [merged],
        p_actor: actor,
      });
      if (error) throw error;
      const data = savedRows?.[0];
      if (!data) throw new Error("Reservation update returned no booking.");
      return sendJson(response, 200, { ok: true, booking: mapBooking(data) });
    }
    if (action === "saveLegacyReservation" || action === "saveLegacyReservations") {
      const rows = action === "saveLegacyReservation"
        ? [request.body.row]
        : request.body.rows;
      if (!Array.isArray(rows) || rows.some((row) => !row)) {
        throw new Error("Reservation rows are required.");
      }
      const bookings = rows.map((row) => legacyReservationToBooking(row));
      bookings.forEach(validateBookingPayload);
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: bookings,
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, {
        ok: true,
        bookings: (data || []).map(mapBooking),
        booking: data?.[0] ? mapBooking(data[0]) : null,
      });
    }
    if (action === "assignTables") {
      const { data: current, error: currentError } = await client.from("reservation_bookings")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("id", request.body.bookingId)
        .single();
      if (currentError) throw currentError;
      const tables = Array.isArray(request.body.tables) ? request.body.tables : [];
      if (!tables.length) throw new Error("Choose at least one table.");
      const booking = {
        ...mapBooking(current),
        tableLabel: tables[0],
        operationalData: {
          ...(current.operational_data || {}),
          tableGroup: tables,
        },
      };
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [booking],
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true, booking: mapBooking(data[0]) });
    }
    if (action === "swapTables") {
      const { data, error } = await client.rpc("swap_reservation_booking_tables", {
        p_workspace: workspace.id,
        p_a: request.body.aId,
        p_b: request.body.bId,
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true, bookings: (data || []).map(mapBooking) });
    }
    if (action === "deleteBooking") {
      const { error } = await client.rpc("delete_reservation_booking", {
        p_workspace: workspace.id,
        p_booking: request.body.bookingId,
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true });
    }
    if (action === "transition") {
      const booking = await transitionBooking(
        client,
        workspace.id,
        request.body.bookingId,
        request.body.toStatus,
        request.body.reason,
        actor,
      );
      return sendJson(response, 200, { ok: true, booking });
    }
    if (action === "addWaitlist") {
      const entry = request.body.entry || {};
      const { data, error } = await client.from("reservation_waitlist").insert({
        workspace_id: workspace.id,
        date: entry.date,
        service: entry.service || null,
        requested_time: entry.time || null,
        time_window: entry.window || null,
        guest_name: entry.name,
        phone: entry.phone || null,
        email: entry.email || null,
        pax: Number(entry.pax),
        quoted_minutes: Number(entry.quotedMinutes || 30),
        notes: entry.notes || null,
        source: "staff",
      }).select("*").single();
      if (error) throw error;
      return sendJson(response, 200, { ok: true, entry: data });
    }
    if (action === "updateWaitlist") {
      const patch = request.body.patch || {};
      const allowed = {};
      if (patch.status) allowed.status = patch.status;
      if (patch.removedReason) allowed.removed_reason = patch.removedReason;
      allowed.updated_at = new Date().toISOString();
      const { data, error } = await client.from("reservation_waitlist")
        .update(allowed)
        .eq("workspace_id", workspace.id)
        .eq("id", request.body.id)
        .select("*")
        .single();
      if (error) throw error;
      return sendJson(response, 200, { ok: true, entry: data });
    }
    if (action === "saveConfig") {
      const { data: before, error: beforeError } = await client.from("reservation_config")
        .select("config,version")
        .eq("workspace_id", workspace.id)
        .single();
      if (beforeError) throw beforeError;
      const nextConfig = normalizeReservationConfig(request.body.config);
      const changes = Array.isArray(request.body.changes) && request.body.changes.length
        ? request.body.changes
        : [{
          section: "Reservations",
          field: "configuration",
          oldValue: before.config,
          newValue: nextConfig,
        }];
      const { data, error } = await client.rpc("save_reservation_config", {
        p_workspace: workspace.id,
        p_config: nextConfig,
        p_changes: changes,
        p_actor: actor,
      });
      if (error) throw error;
      const saved = data?.[0];
      if (!saved) throw new Error("Reservation configuration write returned no result.");
      return sendJson(response, 200, {
        ok: true,
        version: Number(saved.version),
        config: saved.config,
      });
    }
    if (action === "saveAdminSettings") {
      const nextConfig = normalizeReservationConfig(request.body.config);
      const services = Array.isArray(request.body.services)
        ? request.body.services
        : request.body.weeklyServices;
      const rules = Array.isArray(request.body.rules)
        ? request.body.rules
        : request.body.exceptions;
      if (!Array.isArray(services) || !Array.isArray(rules)) {
        throw new Error("Services and calendar rules are required.");
      }
      const { data, error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: nextConfig,
        p_services: services,
        p_rules: rules,
        p_changes: Array.isArray(request.body.changes) ? request.body.changes : [],
        p_actor: actor,
      });
      if (error) throw error;
      const saved = data?.[0];
      if (!saved) throw new Error("Reservation settings write returned no result.");
      return sendJson(response, 200, {
        ok: true,
        version: Number(saved.version),
        config: saved.config,
      });
    }
    if (action === "saveSchedule" || action === "saveServices") {
      const rows = Array.isArray(request.body.services) ? request.body.services : [];
      const state = await loadReservationContext(client, workspace.id);
      const { error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: state.config,
        p_services: rows,
        p_rules: state.exceptions,
        p_changes: Array.isArray(request.body.changes) && request.body.changes.length
          ? request.body.changes
          : [{
            section: "Services & Hours",
            field: "weekly schedule",
            oldValue: state.services,
            newValue: rows,
          }],
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true });
    }
    if (action === "saveCalendarRules") {
      const rules = Array.isArray(request.body.rules)
        ? request.body.rules
        : request.body.exceptions;
      if (!Array.isArray(rules)) throw new Error("Calendar rules are required.");
      const state = await loadReservationContext(client, workspace.id);
      const { error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: state.config,
        p_services: state.services,
        p_rules: rules,
        p_changes: Array.isArray(request.body.changes) && request.body.changes.length
          ? request.body.changes
          : [{
            section: "Calendar & Closures",
            field: "calendar rules",
            oldValue: state.exceptions,
            newValue: rules,
          }],
        p_actor: actor,
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true });
    }
    if (action === "saveCalendarRule") {
      const rule = request.body.rule || {};
      const row = {
        workspace_id: workspace.id,
        date: rule.date,
        kind: rule.kind,
        service: rule.service || null,
        mode: rule.mode || null,
        first_seating: rule.first || null,
        last_seating: rule.last || null,
        interval_min: rule.interval || null,
        online_off: Boolean(rule.onlineOff),
        capacity: rule.capacity || null,
        label: rule.label || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = rule.id
        ? await client.from("reservation_calendar_rules").update(row).eq("id", rule.id).eq("workspace_id", workspace.id).select("*").single()
        : await client.from("reservation_calendar_rules").insert(row).select("*").single();
      if (error) throw error;
      return sendJson(response, 200, { ok: true, rule: mapException(data) });
    }
    if (action === "deleteCalendarRule") {
      const { error } = await client.from("reservation_calendar_rules")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", request.body.id);
      if (error) throw error;
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 400, { ok: false, error: "unknown_action" });
  } catch (error) {
    console.error("[reservations-staff]", error);
    return sendJson(response, error.statusCode || 400, {
      ok: false,
      error: error.code || "request_failed",
      message: error.message,
    });
  }
}
