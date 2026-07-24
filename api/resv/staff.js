import {
  assertLabAccess,
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
    assertLabAccess(request);
    const client = getAdminClient();
    const workspace = await getWorkspace(client);
    if (request.method === "GET") {
      return sendJson(response, 200, { ok: true, workspace, state: await loadState(client, workspace.id) });
    }
    if (request.method !== "POST") return methodNotAllowed(response);

    const action = String(request.body?.action || "");
    const actor = "LAB STAFF";
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
      const { data, error } = await client
        .from("reservation_bookings")
        .update({
          date: booking.date,
          service: booking.service,
          booking_time: booking.time,
          pax: Number(booking.pax),
          guest_name: booking.name,
          phone: booking.phone || null,
          email: booking.email || null,
          language: booking.language || "en",
          experience: booking.experience || null,
          occasion: booking.occasion || null,
          notes: booking.notes || null,
          allergies: booking.allergies || [],
          accessibility: booking.accessibility || [],
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", booking.id)
        .select("*")
        .single();
      if (error) throw error;
      await client.from("reservation_status_events").insert({
        workspace_id: workspace.id,
        booking_id: booking.id,
        actor,
        event_type: "modified",
        note: JSON.stringify({
          from: { date: before.date, time: before.booking_time, pax: before.pax },
          to: { date: data.date, time: data.booking_time, pax: data.pax },
        }),
      });
      return sendJson(response, 200, { ok: true, booking: mapBooking(data) });
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
      const nextVersion = Number(before.version || 1) + 1;
      const { error } = await client.from("reservation_config").update({
        config: request.body.config,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspace.id);
      if (error) throw error;
      await client.from("reservation_admin_audit").insert({
        workspace_id: workspace.id,
        actor,
        section: "Reservations",
        field: "configuration",
        old_value: before.config,
        new_value: request.body.config,
      });
      return sendJson(response, 200, { ok: true, version: nextVersion });
    }
    if (action === "saveSchedule") {
      const rows = Array.isArray(request.body.services) ? request.body.services : [];
      const { error: deleteError } = await client.from("reservation_services")
        .delete()
        .eq("workspace_id", workspace.id);
      if (deleteError) throw deleteError;
      const inserts = rows.filter((row) => row.enabled).map((row) => ({
        workspace_id: workspace.id,
        service: row.service,
        weekday: Number(row.weekday),
        enabled: true,
        first_seating: row.first,
        last_seating: row.last,
        interval_min: Number(row.interval || 30),
        online_enabled: row.onlineEnabled !== false,
      }));
      if (inserts.length) {
        const { error } = await client.from("reservation_services").insert(inserts);
        if (error) throw error;
      }
      await client.from("reservation_admin_audit").insert({
        workspace_id: workspace.id,
        actor,
        section: "Services & Hours",
        field: "weekly schedule",
        new_value: rows,
      });
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
