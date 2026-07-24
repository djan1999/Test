import {
  createBooking,
  getAdminClient,
  getAvailability,
  getWorkspace,
  mapBooking,
  methodNotAllowed,
  publicConfig,
  resolveManageToken,
  sendJson,
  transitionBooking,
  validateBookingChoice,
} from "./_shared.js";

function publicAvailability(services) {
  return services.map((service) => ({
    service: service.service,
    slots: service.slots.map(({ time, ok }) => ({ time, ok })),
  }));
}

export default async function handler(request, response) {
  try {
    const client = getAdminClient();
    const workspace = await getWorkspace(client);
    if (request.method === "GET") {
      const mode = String(request.query.mode || "config");
      if (mode === "config") {
        const { data, error } = await client
          .from("reservation_config")
          .select("config")
          .eq("workspace_id", workspace.id)
          .single();
        if (error) throw error;
        return sendJson(response, 200, { ok: true, config: publicConfig(data.config) });
      }
      if (mode === "availability") {
        const date = String(request.query.date || "");
        const pax = Number(request.query.pax || 2);
        const result = await getAvailability(client, workspace.id, { date, pax, publicOnly: true });
        return sendJson(response, 200, {
          ok: true,
          services: publicAvailability(result.services),
          anyOk: result.services.some((service) => service.slots.some((slot) => slot.ok)),
        });
      }
      if (mode === "manage") {
        const result = await resolveManageToken(client, request.query.token);
        if (!result) return sendJson(response, 404, { ok: false, error: "expired_link" });
        const { booking } = result;
        return sendJson(response, 200, {
          ok: true,
          booking: {
            ref: booking.ref,
            date: booking.date,
            service: booking.service,
            time: booking.time,
            pax: booking.pax,
            name: booking.name,
            status: booking.status,
            phone: booking.phone,
            email: booking.email,
            language: booking.language,
            experience: booking.experience,
            occasion: booking.occasion,
            notes: booking.notes,
            allergies: booking.allergies,
            accessibility: booking.accessibility,
          },
        });
      }
      return sendJson(response, 400, { ok: false, error: "unknown_mode" });
    }

    if (request.method !== "POST") return methodNotAllowed(response);
    const action = String(request.body?.action || "");
    if (action === "validate") {
      const booking = {
        ...request.body.booking,
        source: "web",
        idempotencyKey: request.body.idempotencyKey,
      };
      const { status } = await validateBookingChoice(client, workspace.id, booking, { publicOnly: true });
      return sendJson(response, 200, {
        ok: true,
        ref: "TEST-VALID",
        manageUrl: null,
        status,
      });
    }
    if (action === "submit") {
      const result = await createBooking(client, workspace.id, {
        ...request.body.booking,
        source: "web",
        actor: "WEB",
        idempotencyKey: request.body.idempotencyKey,
      }, { publicOnly: true });
      const origin = `${request.headers["x-forwarded-proto"] || "https"}://${request.headers.host}`;
      return sendJson(response, 200, {
        ok: true,
        ref: result.booking.ref,
        status: result.booking.status,
        manageUrl: result.manageToken
          ? `${origin}/book/manage/${result.manageToken}`
          : null,
        replay: result.replay,
      });
    }
    if (action === "waitlist") {
      const entry = request.body.entry || {};
      if (!entry.date || !entry.name || !Number(entry.pax)) throw new Error("Date, name and party size are required.");
      const { error } = await client.from("reservation_waitlist").insert({
        workspace_id: workspace.id,
        date: entry.date,
        service: entry.service || null,
        requested_time: entry.time || null,
        time_window: entry.window || null,
        guest_name: String(entry.name).trim(),
        phone: String(entry.phone || "").trim() || null,
        email: String(entry.email || "").trim().toLowerCase() || null,
        pax: Number(entry.pax),
        notes: entry.notes || null,
        source: "web",
      });
      if (error) throw error;
      return sendJson(response, 200, { ok: true });
    }
    if (action === "cancel") {
      const managed = await resolveManageToken(client, request.body.token);
      if (!managed) return sendJson(response, 404, { ok: false, error: "expired_link" });
      const booking = await transitionBooking(
        client,
        managed.workspaceId,
        managed.booking.id,
        "cancelled",
        request.body.reason || "Cancelled by guest",
        "WEB",
      );
      await client.from("reservation_manage_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", managed.tokenHash);
      return sendJson(response, 200, { ok: true, status: booking.status });
    }
    if (action === "change") {
      const managed = await resolveManageToken(client, request.body.token);
      if (!managed) return sendJson(response, 404, { ok: false, error: "expired_link" });
      const input = request.body.booking || {};
      const idempotencyKey = String(request.body.idempotencyKey || "").trim();
      if (idempotencyKey && managed.booking.operationalData?.lastManageChangeKey === idempotencyKey) {
        return sendJson(response, 200, {
          ok: true,
          ref: managed.booking.ref,
          manageUrl: `/book/manage/${request.body.token}`,
          status: managed.booking.status,
          replay: true,
        });
      }
      const { slot } = await validateBookingChoice(client, managed.workspaceId, input, {
        publicOnly: true,
        excludeBookingId: managed.booking.id,
      });
      const next = {
        ...managed.booking,
        ...input,
        id: managed.booking.id,
        ref: managed.booking.ref,
        status: managed.booking.status,
        source: "web",
        tableLabel: slot?.tableLabel || managed.booking.tableLabel,
        operationalData: {
          ...(managed.booking.operationalData || {}),
          ...(input.operationalData || {}),
          tableGroup: slot?.tables || [],
          lastManageChangeKey: idempotencyKey || null,
        },
      };
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: managed.workspaceId,
        p_bookings: [next],
        p_actor: "WEB",
      });
      if (error) throw error;
      if (!data?.[0]) throw new Error("Reservation change returned no booking.");
      const saved = mapBooking(data[0]);
      await client.from("reservation_status_events").insert({
        workspace_id: managed.workspaceId,
        booking_id: saved.id,
        actor: "WEB",
        event_type: "booking_changed",
        from_status: managed.booking.status,
        to_status: saved.status,
        reason: "Date or time changed by guest",
      });
      return sendJson(response, 200, {
        ok: true,
        ref: saved.ref,
        manageUrl: `/book/manage/${request.body.token}`,
        status: saved.status,
      });
    }
    return sendJson(response, 400, { ok: false, error: "unknown_action" });
  } catch (error) {
    console.error("[reservations-public]", error);
    return sendJson(response, error.statusCode || 400, {
      ok: false,
      error: error.code || "request_failed",
      message: error.message,
    });
  }
}
