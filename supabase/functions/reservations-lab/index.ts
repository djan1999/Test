import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// The availability rules are NOT written here. They are the same domain modules
// the app and the Vercel route use, copied in verbatim by
// `npm run sync:edge-domain` because the Supabase bundler cannot reach ../../src.
// A hand-written second copy is how this function came to miss combined tables.
import {
  availabilityForRequest,
  restaurantClock,
} from "../_shared/reservations/availability.js";
import {
  experiencesFor,
  normalizeReservationConfig,
  publicConfigOf,
} from "../_shared/reservations/config.js";
import { assertReservationTransition } from "../_shared/reservations/lifecycle.js";
import { foldVisitsIntoGuests } from "../_shared/reservations/guestHistory.js";
import { validateBookingPayload, validateWaitlistEntry } from "../_shared/reservations/validation.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-milka-lab-access, x-milka-workspace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...cors, "Cache-Control": "no-store" } });

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const randomRef = () =>
  `MK-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

function mapService(row: Record<string, unknown>) {
  return {
    id: row.id,
    service: row.service,
    weekday: Number(row.weekday),
    enabled: row.enabled,
    first: String(row.first_seating || "").slice(0, 5),
    last: String(row.last_seating || "").slice(0, 5),
    interval: Number(row.interval_min),
    onlineEnabled: row.online_enabled,
    walkInsEnabled: row.walkins_enabled !== false,
    minPax: row.min_pax == null ? null : Number(row.min_pax),
    maxPax: row.max_pax == null ? null : Number(row.max_pax),
  };
}

function mapRule(row: Record<string, unknown>) {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    service: row.service,
    mode: row.mode,
    first: row.first_seating ? String(row.first_seating).slice(0, 5) : null,
    last: row.last_seating ? String(row.last_seating).slice(0, 5) : null,
    interval: row.interval_min,
    onlineOff: row.online_off,
    capacity: row.capacity,
    label: row.label,
  };
}

function mapBooking(row: Record<string, unknown>) {
  return {
    id: row.id,
    date: row.date,
    service: row.service,
    time: String(row.booking_time || "").slice(0, 5),
    pax: Number(row.pax),
    status: row.status,
    name: row.guest_name,
    phone: row.phone || "",
    email: row.email || "",
    language: row.language || "en",
    source: row.source,
    ref: row.ref,
    tableLabel: row.table_label,
    experience: row.experience || "",
    occasion: row.occasion || "",
    notes: row.notes || "",
    allergies: row.allergies || [],
    accessibility: row.accessibility || [],
    consentNews: row.consent_news,
    operationalData: row.operational_data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tableLabel(value: unknown) {
  const match = String(value || "").match(/(\d+)/);
  return match ? `T${String(Number(match[1])).padStart(2, "0")}` : null;
}

function legacyToBooking(row: any) {
  const data = row?.data || {};
  const group = Array.isArray(data.tableGroup) && data.tableGroup.length
    ? data.tableGroup
    : (row?.table_id != null ? [row.table_id] : []);
  const labels = group.map(tableLabel).filter(Boolean);
  return {
    id: row?.id,
    date: row?.date,
    service: data.service_session || "dinner",
    time: data.resTime || "",
    pax: Number(data.guests || 1),
    status: data.booking_status || "confirmed",
    name: data.resName || "Reservation",
    phone: data.phone || "",
    email: data.email || "",
    language: data.lang || "en",
    source: ["staff", "web", "phone", "walk_in", "waitlist"].includes(data.source) ? data.source : "staff",
    ref: data.ref || "",
    tableLabel: labels[0] || tableLabel(row?.table_id),
    experience: data.experience || "",
    occasion: data.occasion || "",
    notes: data.notes || "",
    allergies: Array.isArray(data.restrictions) ? data.restrictions : [],
    accessibility: Array.isArray(data.accessibility) ? data.accessibility : [],
    consentNews: Boolean(data.consentNews),
    operationalData: { ...data, tableGroup: labels },
  };
}

/** One request's availability, decided by the shared domain engine. The window,
 *  the online switch, today's lead time and the guest's own booking are all
 *  handled there, so this function and the Vercel route cannot disagree. */
function availabilityOf(context: any, {
  date, pax, publicOnly = false, experience = null, excludeBookingId = null,
}: Record<string, any>) {
  return availabilityForRequest({
    date,
    pax: Number(pax),
    services: context.services,
    exceptions: context.exceptions,
    bookings: context.bookings,
    config: context.config,
    publicOnly,
    experience,
    excludeBookingId,
    now: restaurantClock(normalizeReservationConfig(context.config).timezone),
  });
}

/** The manage link has to outlive a change of date. A guest who moves from next
 *  week to next month keeps the same link, so its expiry moves with them. */
async function extendManageToken(client: any, tokenHash: string, date: string) {
  const expires = new Date(`${date}T23:59:59+02:00`);
  expires.setDate(expires.getDate() + 1);
  const { error } = await client.from("reservation_manage_tokens")
    .update({ expires_at: expires.toISOString() })
    .eq("token_hash", tokenHash);
  if (error) throw error;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await request.json();
    const action = String(body.action || "");
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: workspace, error: workspaceError } = await client.from("workspaces").select("id,slug,name").eq("slug", "milka-reservations-lab").single();
    if (workspaceError) throw workspaceError;

    const staffActions = new Set([
      "staffState", "createBooking", "updateBooking", "transition", "addWaitlist",
      "updateWaitlist", "saveConfig", "saveAdminSettings", "saveSchedule", "saveServices",
      "saveCalendarRule", "saveCalendarRules", "deleteCalendarRule", "saveLegacyReservation",
      "saveLegacyReservations", "assignTables", "swapTables", "deleteBooking", "convertWaitlist",
    ]);
    const adminActions = new Set([
      "saveConfig", "saveAdminSettings", "saveSchedule", "saveServices",
      "saveCalendarRule", "saveCalendarRules", "deleteCalendarRule",
    ]);
    let staffActor = "LAB STAFF";
    if (staffActions.has(action)) {
      const code = String(request.headers.get("x-milka-lab-access") || body.accessCode || "");
      let authorizedByCode = false;
      if (code) {
        const { data: auth, error: authError } = await client.from("reservation_lab_auth")
          .select("access_code_hash")
          .eq("workspace_id", workspace.id)
          .single();
        if (authError) throw authError;
        authorizedByCode = await sha256(code) === auth.access_code_hash;
      }
      if (!authorizedByCode) {
        const authorization = String(request.headers.get("authorization") || "");
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        const membershipWorkspace = String(request.headers.get("x-milka-workspace-id") || "");
        if (!token || !membershipWorkspace) {
          return json(401, { ok: false, error: "staff_access_required", message: "Sign in to Milka or enter the LAB access code." });
        }
        const { data: authData, error: userError } = await client.auth.getUser(token);
        const userId = authData?.user?.id;
        if (userError || !userId) {
          return json(401, { ok: false, error: "expired_login", message: "Your Milka login expired. Sign in again." });
        }
        const { data: membership, error: membershipError } = await client.from("workspace_members")
          .select("role")
          .eq("workspace_id", membershipWorkspace)
          .eq("user_id", userId)
          .maybeSingle();
        if (membershipError) throw membershipError;
        const role = String(membership?.role || "").toLowerCase();
        const permitted = adminActions.has(action)
          ? role === "admin"
          : ["admin", "service"].includes(role);
        if (!permitted) {
          return json(403, {
            ok: false,
            error: "role_forbidden",
            message: adminActions.has(action)
              ? "Only a Milka Admin can change reservation settings."
              : "Your Milka role cannot manage reservations.",
          });
        }
        staffActor = `MILKA:${userId}`;
      }
    }

    const loadContext = async (date?: string) => {
      let bookingQuery = client.from("reservation_bookings").select("*").eq("workspace_id", workspace.id).order("date").order("booking_time");
      if (date) bookingQuery = bookingQuery.eq("date", date);
      const [configResult, servicesResult, rulesResult, bookingsResult] = await Promise.all([
        client.from("reservation_config").select("config,version").eq("workspace_id", workspace.id).single(),
        client.from("reservation_services").select("*").eq("workspace_id", workspace.id).order("weekday").order("first_seating"),
        client.from("reservation_calendar_rules").select("*").eq("workspace_id", workspace.id).order("date"),
        bookingQuery,
      ]);
      for (const result of [configResult, servicesResult, rulesResult, bookingsResult]) if (result.error) throw result.error;
      return {
        config: configResult.data.config,
        configVersion: Number(configResult.data.version || 1),
        services: (servicesResult.data || []).map(mapService),
        exceptions: (rulesResult.data || []).map(mapRule),
        bookings: (bookingsResult.data || []).map(mapBooking),
      };
    };

    const event = async (bookingId: string, values: Record<string, unknown>) => {
      const { error } = await client.from("reservation_status_events").insert({
        workspace_id: workspace.id,
        booking_id: bookingId,
        ...values,
      });
      if (error) throw error;
    };

    const upsertGuest = async (booking: any) => {
      const contact = booking.email || booking.phone || booking.name;
      const nameKey = `${String(booking.name).trim().toLowerCase()}|${String(contact).trim().toLowerCase()}`;
      const { data: existing, error } = await client.from("reservation_guests").select("id,visit_count").eq("workspace_id", workspace.id).eq("name_key", nameKey).maybeSingle();
      if (error) throw error;
      const row = {
        workspace_id: workspace.id,
        name_key: nameKey,
        name: booking.name,
        phone: booking.phone || null,
        email: booking.email || null,
        language: booking.language || "en",
        visit_count: Number(existing?.visit_count || 0) + (booking.status === "completed" ? 1 : 0),
        last_visit: booking.status === "completed" ? booking.date : null,
        updated_at: new Date().toISOString(),
      };
      const result = existing
        ? await client.from("reservation_guests").update(row).eq("id", existing.id)
        : await client.from("reservation_guests").insert(row);
      if (result.error) throw result.error;
    };

    const choiceFor = async (input: any, publicOnly: boolean, excludeBookingId?: string) => {
      validateBookingPayload(input);
      const context = await loadContext(input.date);
      const result = availabilityOf(context, {
        date: input.date,
        pax: input.pax,
        publicOnly,
        excludeBookingId: excludeBookingId || null,
      });
      const config = result.config;
      if (result.onlineClosed) {
        const error: any = new Error("Online booking is closed. Please telephone the restaurant.");
        error.code = "online_closed";
        throw error;
      }
      if (result.outsideWindow) {
        const error: any = new Error("That date is outside the online booking window.");
        error.code = "outside_window";
        throw error;
      }
      const allowOverride = Boolean(input.overrideReason) || !publicOnly;
      // Step 4 of the resolution order — an experience the restaurant curates
      // may only be booked on a service that offers it. Free text a host typed
      // matches no configured key and stays unrestricted.
      const requested = String(input.experience || "").trim();
      const curated = requested && config.experiences.some((item: any) => item.key === requested);
      if (curated && !allowOverride
          && !experiencesFor(input.service, config).some((item: any) => item.key === requested)) {
        const error: any = new Error("That menu is not served at this time.");
        error.code = "not_offered";
        throw error;
      }
      if (publicOnly && Number(input.pax) > Number(config.online.maxPax)) {
        const error: any = new Error("This party is too large for online booking.");
        error.code = "party_too_large";
        throw error;
      }
      const service = result.services.find((item: any) => item.service === input.service);
      const candidate = service?.slots.find((item: any) => item.time === input.time);
      const slot = candidate?.ok ? candidate : null;
      if (!slot && !allowOverride) {
        const error: any = new Error(candidate?.reason === "no_table"
          ? "No table of the right size is free then."
          : "That time is no longer available.");
        error.code = candidate?.reason === "no_table" ? "no_table" : (
          candidate?.reason === "party_too_large" ? "party_too_large" : "slot_taken"
        );
        throw error;
      }
      const status = input.status || (
        publicOnly && Number(input.pax) > Number(config.online.autoConfirmMaxPax)
          ? "pending"
          : "confirmed"
      );
      return { context, config, slot, status, overrideReason: slot ? null : (candidate?.reason || "no_slot") };
    };

    const createBooking = async (input: any, publicOnly: boolean) => {
      validateBookingPayload(input);
      const idempotencyKey = String(input.idempotencyKey || crypto.randomUUID());
      const { data: replay, error: replayError } = await client.from("reservation_bookings").select("*").eq("workspace_id", workspace.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (replayError) throw replayError;
      if (replay) {
        let token = null;
        if (publicOnly) {
          token = randomToken();
          const expires = new Date(`${replay.date}T23:59:59+02:00`);
          expires.setDate(expires.getDate() + 1);
          const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
            token_hash: await sha256(token),
            workspace_id: workspace.id,
            booking_id: replay.id,
            expires_at: expires.toISOString(),
          });
          if (tokenError) throw tokenError;
        }
        return { booking: mapBooking(replay), replay: true, token };
      }
      const { slot, status } = await choiceFor(input, publicOnly);
      const ref = randomRef();
      const rpcBooking = {
        id: input.id,
        date: input.date,
        service: input.service,
        time: input.time,
        pax: Number(input.pax),
        status,
        name: String(input.name).trim(),
        phone: String(input.phone || "").trim() || null,
        email: String(input.email || "").trim().toLowerCase() || null,
        language: input.language || "en",
        source: input.source || (publicOnly ? "web" : "staff"),
        ref,
        tableLabel: publicOnly
          ? (slot?.tableLabel || input.tableLabel || null)
          : (input.tableLabel || slot?.tableLabel || null),
        experience: input.experience || null,
        occasion: input.occasion || null,
        notes: input.notes || null,
        allergies: Array.isArray(input.allergies) ? input.allergies : [],
        accessibility: Array.isArray(input.accessibility) ? input.accessibility : [],
        consentNews: Boolean(input.consentNews),
        idempotencyKey,
        createdBy: publicOnly ? "WEB" : staffActor,
        operationalData: {
          ...(input.operationalData || {}),
          // A joined party holds EVERY table in the group. Recording only the
          // first would leave the second looking free to the next booking.
          tableGroup: input.operationalData?.tableGroup || (
            input.tableLabel ? [input.tableLabel] : (slot?.tables || [])
          ),
        },
      };
      const { data: savedRows, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [rpcBooking],
        p_actor: publicOnly ? "WEB" : staffActor,
      });
      if (error) {
        // A concurrent retry of the same key gets past the replay SELECT above and
        // then loses the unique (workspace_id, idempotency_key) race. It must still
        // resolve to the ORIGINAL booking, never a duplicate-key error.
        if ((error as any).code === "23505") {
          const { data: duplicate, error: duplicateError } = await client.from("reservation_bookings")
            .select("*").eq("workspace_id", workspace.id).eq("idempotency_key", idempotencyKey).single();
          if (duplicateError) throw duplicateError;
          let duplicateToken = null;
          if (publicOnly) {
            duplicateToken = randomToken();
            const expires = new Date(`${duplicate.date}T23:59:59+02:00`);
            expires.setDate(expires.getDate() + 1);
            const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
              token_hash: await sha256(duplicateToken),
              workspace_id: workspace.id,
              booking_id: duplicate.id,
              expires_at: expires.toISOString(),
            });
            if (tokenError) throw tokenError;
          }
          return { booking: mapBooking(duplicate), replay: true, token: duplicateToken };
        }
        if (String(error.message || "").includes("slot_taken")) error.code = "slot_taken";
        throw error;
      }
      const data = savedRows?.[0];
      if (!data) throw new Error("Reservation write returned no booking.");
      const booking = mapBooking(data);
      await upsertGuest(booking);
      let token = null;
      if (publicOnly) {
        token = randomToken();
        const expires = new Date(`${input.date}T23:59:59+02:00`);
        expires.setDate(expires.getDate() + 1);
        const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
          token_hash: await sha256(token),
          workspace_id: workspace.id,
          booking_id: data.id,
          expires_at: expires.toISOString(),
        });
        if (tokenError) throw tokenError;
      }
      return { booking, replay: false, token };
    };

    const resolveToken = async (raw: string) => {
      const hash = await sha256(String(raw || ""));
      const { data: token, error } = await client.from("reservation_manage_tokens").select("*").eq("token_hash", hash).maybeSingle();
      if (error) throw error;
      if (!token || token.revoked_at || new Date(token.expires_at) < new Date()) return null;
      const { data: booking, error: bookingError } = await client.from("reservation_bookings").select("*").eq("id", token.booking_id).single();
      if (bookingError) throw bookingError;
      return { hash, booking: mapBooking(booking) };
    };

    if (action === "publicConfig") {
      const context = await loadContext();
      return json(200, { ok: true, config: publicConfigOf(context.config) });
    }
    if (action === "availability") {
      const context = await loadContext(body.date);
      // A guest changing an existing booking must not be blocked by their own
      // table. The booking to exclude is derived from the manage token, never
      // taken as a raw id, so nobody can free a table they do not hold.
      const managed = body.token ? await resolveToken(String(body.token)) : null;
      const result = availabilityOf(context, {
        date: body.date,
        pax: Number(body.pax || 2),
        publicOnly: true,
        excludeBookingId: managed?.booking?.id || null,
      });
      // The reason travels with the slot. It names a capacity or a table size —
      // never another guest — and it is the difference between "no" and a "no"
      // the guest can act on.
      const services = result.services.map((service: any) => ({
        service: service.service,
        slots: service.slots.map(({ time, ok, reason }: any) => ({ time, ok, reason })),
      }));
      return json(200, {
        ok: true,
        services,
        anyOk: services.some((service: any) => service.slots.some((slot: any) => slot.ok)),
      });
    }
    if (action === "validate") {
      const { status } = await choiceFor({ ...body.booking, idempotencyKey: body.idempotencyKey, source: "web" }, true);
      return json(200, { ok: true, ref: "TEST-VALID", manageUrl: null, status });
    }
    if (action === "submit") {
      const result = await createBooking({ ...body.booking, idempotencyKey: body.idempotencyKey, source: "web" }, true);
      const origin = request.headers.get("origin") || "";
      return json(200, { ok: true, ref: result.booking.ref, status: result.booking.status, manageUrl: result.token ? `${origin}/book/manage/${result.token}` : null, replay: result.replay });
    }
    if (action === "waitlist") {
      // Unauthenticated write: the same bounds the booking form is held to,
      // so nobody can park unbounded text in the waitlist table.
      const entry = body.entry || {};
      validateWaitlistEntry(entry);
      const { error } = await client.from("reservation_waitlist").insert({
        workspace_id: workspace.id, date: entry.date, service: entry.service || null,
        requested_time: entry.time || null, time_window: entry.window || null,
        guest_name: String(entry.name).trim(), phone: entry.phone || null,
        email: String(entry.email || "").trim().toLowerCase() || null, pax: Number(entry.pax),
        notes: entry.notes || null, source: "web",
      });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (action === "manage") {
      const managed = await resolveToken(body.token);
      if (!managed) return json(404, { ok: false, error: "expired_link" });
      const booking = managed.booking;
      return json(200, { ok: true, booking: {
        ref: booking.ref, date: booking.date, service: booking.service,
        time: booking.time, pax: booking.pax, name: booking.name, status: booking.status,
        phone: booking.phone, email: booking.email, language: booking.language,
        experience: booking.experience, occasion: booking.occasion, notes: booking.notes,
        allergies: booking.allergies, accessibility: booking.accessibility,
      } });
    }
    if (action === "cancel") {
      const managed = await resolveToken(body.token);
      if (!managed) return json(404, { ok: false, error: "expired_link" });
      assertReservationTransition(managed.booking.status, "cancelled", body.reason || "Cancelled by guest");
      const { error } = await client.from("reservation_bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", managed.booking.id);
      if (error) throw error;
      await event(managed.booking.id, { actor: "WEB", event_type: "status_changed", from_status: managed.booking.status, to_status: "cancelled", reason: body.reason || "Cancelled by guest" });
      await client.from("reservation_manage_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", managed.hash);
      return json(200, { ok: true, status: "cancelled" });
    }
    if (action === "change") {
      const managed = await resolveToken(body.token);
      if (!managed) return json(404, { ok: false, error: "expired_link" });
      const input = body.booking || {};
      const idempotencyKey = String(body.idempotencyKey || "");
      if (idempotencyKey && managed.booking.operationalData?.lastManageChangeKey === idempotencyKey) {
        return json(200, {
          ok: true, ref: managed.booking.ref, status: managed.booking.status,
          manageUrl: `/book/manage/${body.token}`, replay: true,
        });
      }
      const { slot } = await choiceFor(input, true, managed.booking.id);
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
          // Every table of a joined party, not just the first: dropping the
          // rest silently hands the second table to the next booking.
          tableGroup: slot?.tables || [],
          lastManageChangeKey: idempotencyKey || null,
        },
      };
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [next],
        p_actor: "WEB",
      });
      if (error) throw error;
      if (!data?.[0]) throw new Error("Reservation change returned no booking.");
      const saved = mapBooking(data[0]);
      // The link must still work on the new date — see extendManageToken.
      await extendManageToken(client, managed.hash, saved.date);
      await event(saved.id, {
        actor: "WEB",
        event_type: "booking_changed",
        from_status: managed.booking.status,
        to_status: saved.status,
        reason: "Date or time changed by guest",
      });
      return json(200, {
        ok: true, ref: saved.ref, status: saved.status,
        manageUrl: `/book/manage/${body.token}`,
      });
    }
    if (action === "staffState") {
      const context = await loadContext();
      const [waitlist, guests, events, audit] = await Promise.all([
        client.from("reservation_waitlist").select("*").eq("workspace_id", workspace.id).order("created_at"),
        client.from("reservation_guests").select("*").eq("workspace_id", workspace.id).is("merged_into", null).order("name"),
        client.from("reservation_status_events").select("*").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(300),
        client.from("reservation_admin_audit").select("*").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(200),
      ]);
      for (const result of [waitlist, guests, events, audit]) if (result.error) throw result.error;
      return json(200, { ok: true, workspace, state: {
        ...context,
        waitlist: (waitlist.data || []).map((entry) => ({
          id: entry.id, date: entry.date, service: entry.service,
          time: entry.requested_time ? String(entry.requested_time).slice(0, 5) : "",
          window: entry.time_window || "", name: entry.guest_name, phone: entry.phone || "",
          email: entry.email || "", pax: Number(entry.pax), quotedMinutes: entry.quoted_minutes,
          notes: entry.notes || "", status: entry.status, createdAt: entry.created_at,
        })),
        guests: guests.data || [], events: events.data || [], audit: audit.data || [],
      } });
    }
    if (action === "createBooking") {
      const result = await createBooking({ ...body.booking, source: body.booking?.source || "staff" }, false);
      return json(200, { ok: true, booking: result.booking });
    }
    if (action === "updateBooking") {
      const booking = body.booking || {};
      validateBookingPayload(booking);
      const { data: current, error: currentError } = await client.from("reservation_bookings")
        .select("*").eq("workspace_id", workspace.id).eq("id", booking.id).single();
      if (currentError) throw currentError;
      // An edit is not a back door around the lifecycle — see the same guard in
      // api/resv/staff.js. Without it, a cancellation could be made by saving
      // the booking with a different status, and the reason would be missing.
      const nextStatus = booking.status || current.status;
      if (nextStatus !== current.status) {
        assertReservationTransition(current.status, nextStatus, body.reason || booking.reason || "");
      }
      const merged = {
        ...mapBooking(current),
        ...booking,
        id: current.id,
        status: nextStatus,
        operationalData: {
          ...(current.operational_data || {}),
          ...(booking.operationalData || {}),
        },
      };
      const { data: savedRows, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [merged],
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true, booking: mapBooking(savedRows[0]) });
    }
    if (action === "saveLegacyReservation" || action === "saveLegacyReservations") {
      const rows = action === "saveLegacyReservation" ? [body.row] : body.rows;
      if (!Array.isArray(rows) || rows.some((row) => !row)) throw new Error("Reservation rows are required.");
      const bookings = rows.map(legacyToBooking);
      bookings.forEach(validateBookingPayload);
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: bookings,
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, {
        ok: true,
        bookings: (data || []).map(mapBooking),
        booking: data?.[0] ? mapBooking(data[0]) : null,
      });
    }
    if (action === "assignTables") {
      const { data: current, error: currentError } = await client.from("reservation_bookings")
        .select("*").eq("workspace_id", workspace.id).eq("id", body.bookingId).single();
      if (currentError) throw currentError;
      const tables = Array.isArray(body.tables) ? body.tables : [];
      if (!tables.length) throw new Error("Choose at least one table.");
      const booking = {
        ...mapBooking(current),
        tableLabel: tables[0],
        operationalData: { ...(current.operational_data || {}), tableGroup: tables },
      };
      const { data, error } = await client.rpc("save_reservation_booking_rows", {
        p_workspace: workspace.id,
        p_bookings: [booking],
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true, booking: mapBooking(data[0]) });
    }
    if (action === "swapTables") {
      const { data, error } = await client.rpc("swap_reservation_booking_tables", {
        p_workspace: workspace.id,
        p_a: body.aId,
        p_b: body.bId,
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true, bookings: (data || []).map(mapBooking) });
    }
    if (action === "deleteBooking") {
      const { error } = await client.rpc("delete_reservation_booking", {
        p_workspace: workspace.id,
        p_booking: body.bookingId,
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (action === "transition") {
      const { data: current, error: currentError } = await client.from("reservation_bookings").select("*").eq("workspace_id", workspace.id).eq("id", body.bookingId).single();
      if (currentError) throw currentError;
      assertReservationTransition(current.status, body.toStatus, body.reason || "");
      const { data, error } = await client.from("reservation_bookings").update({ status: body.toStatus, updated_at: new Date().toISOString() }).eq("id", current.id).eq("status", current.status).select("*").single();
      if (error) throw error;
      await event(current.id, { actor: staffActor, event_type: "status_changed", from_status: current.status, to_status: body.toStatus, reason: body.reason || null });
      const booking = mapBooking(data);
      if (body.toStatus === "completed") await upsertGuest(booking);
      return json(200, { ok: true, booking });
    }
    if (action === "convertWaitlist") {
      const booking = { ...(body.booking || {}), source: "waitlist" };
      validateBookingPayload(booking);
      const { data, error } = await client.rpc("convert_reservation_waitlist", {
        p_workspace: workspace.id,
        p_waitlist: body.waitlistId,
        p_booking: booking,
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true, booking: mapBooking(data) });
    }
    if (action === "addWaitlist") {
      const entry = body.entry || {};
      validateWaitlistEntry(entry);
      const { error } = await client.from("reservation_waitlist").insert({
        workspace_id: workspace.id, date: entry.date, service: entry.service || null,
        requested_time: entry.time || null, time_window: entry.window || null,
        guest_name: entry.name, phone: entry.phone || null, email: entry.email || null,
        pax: Number(entry.pax), quoted_minutes: Number(entry.quotedMinutes || 30),
        notes: entry.notes || null, source: "staff",
      });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (action === "updateWaitlist") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.patch?.status) patch.status = body.patch.status;
      if (body.patch?.removedReason) patch.removed_reason = body.patch.removedReason;
      const { error } = await client.from("reservation_waitlist").update(patch).eq("workspace_id", workspace.id).eq("id", body.id);
      if (error) throw error;
      return json(200, { ok: true });
    }
    // Loop 2 — the finished service writes guest history. Idempotent on
    // visitId, so a re-archived service replaces its own rows. Reads and
    // writes reservation_guests only; no live-service table is touched.
    if (action === "recordVisits") {
      const visits = Array.isArray(body.visits) ? body.visits : [];
      const keys = [...new Set(visits.map((visit: any) => String(visit.guestKey || "")).filter(Boolean))];
      if (!keys.length) return json(200, { ok: true, updated: 0, skipped: visits.length });
      const { data: guests, error: guestError } = await client
        .from("reservation_guests")
        .select("id,name_key,visits,visit_count,last_visit")
        .eq("workspace_id", workspace.id)
        .in("name_key", keys);
      if (guestError) throw guestError;
      const folded = foldVisitsIntoGuests(guests || [], visits);
      for (const guest of folded.guests) {
        if (!Array.isArray(guest.visits)) continue;
        const { error: updateError } = await client.from("reservation_guests").update({
          visits: guest.visits,
          visit_count: guest.visits.length,
          last_visit: guest.last_visit || null,
          updated_at: new Date().toISOString(),
        }).eq("workspace_id", workspace.id).eq("id", guest.id);
        if (updateError) throw updateError;
      }
      return json(200, { ok: true, updated: folded.updated, skipped: folded.skipped });
    }
    if (action === "saveConfig") {
      const { data: before, error: beforeError } = await client.from("reservation_config").select("config,version").eq("workspace_id", workspace.id).single();
      if (beforeError) throw beforeError;
      const changes = Array.isArray(body.changes) && body.changes.length
        ? body.changes
        : [{ section: "Reservations", field: "configuration", oldValue: before.config, newValue: body.config }];
      const { data, error } = await client.rpc("save_reservation_config", {
        p_workspace: workspace.id,
        p_config: body.config,
        p_changes: changes,
        p_actor: staffActor,
      });
      if (error) throw error;
      const saved = data?.[0];
      if (!saved) throw new Error("Reservation configuration write returned no result.");
      return json(200, { ok: true, version: Number(saved.version), config: saved.config });
    }
    if (action === "saveAdminSettings") {
      const services = Array.isArray(body.services) ? body.services : body.weeklyServices;
      const rules = Array.isArray(body.rules) ? body.rules : body.exceptions;
      if (!body.config || !Array.isArray(services) || !Array.isArray(rules)) {
        throw new Error("Configuration, services and calendar rules are required.");
      }
      const { data, error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: body.config,
        p_services: services,
        p_rules: rules,
        p_changes: Array.isArray(body.changes) ? body.changes : [],
        p_actor: staffActor,
      });
      if (error) throw error;
      const saved = data?.[0];
      if (!saved) throw new Error("Reservation settings write returned no result.");
      return json(200, { ok: true, version: Number(saved.version), config: saved.config });
    }
    if (action === "saveSchedule" || action === "saveServices") {
      const context = await loadContext();
      const rows = Array.isArray(body.services) ? body.services : [];
      const { error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: context.config,
        p_services: rows,
        p_rules: context.exceptions,
        p_changes: Array.isArray(body.changes) && body.changes.length
          ? body.changes
          : [{
            section: "Services & Hours",
            field: "weekly schedule",
            oldValue: context.services,
            newValue: rows,
          }],
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (action === "saveCalendarRules") {
      const rules = Array.isArray(body.rules) ? body.rules : body.exceptions;
      if (!Array.isArray(rules)) throw new Error("Calendar rules are required.");
      const context = await loadContext();
      const { error } = await client.rpc("save_reservation_admin_settings", {
        p_workspace: workspace.id,
        p_config: context.config,
        p_services: context.services,
        p_rules: rules,
        p_changes: Array.isArray(body.changes) && body.changes.length
          ? body.changes
          : [{
            section: "Calendar & Closures",
            field: "calendar rules",
            oldValue: context.exceptions,
            newValue: rules,
          }],
        p_actor: staffActor,
      });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (action === "saveCalendarRule") {
      const rule = body.rule || {};
      const row = {
        workspace_id: workspace.id, date: rule.date, kind: rule.kind,
        service: rule.service || null, mode: rule.mode || null,
        first_seating: rule.first || null, last_seating: rule.last || null,
        interval_min: rule.interval || null, online_off: Boolean(rule.onlineOff),
        capacity: rule.capacity || null, label: rule.label || null, updated_at: new Date().toISOString(),
      };
      const result = rule.id
        ? await client.from("reservation_calendar_rules").update(row).eq("id", rule.id).eq("workspace_id", workspace.id).select("*").single()
        : await client.from("reservation_calendar_rules").insert(row).select("*").single();
      if (result.error) throw result.error;
      return json(200, { ok: true, rule: mapRule(result.data) });
    }
    if (action === "deleteCalendarRule") {
      const { error } = await client.from("reservation_calendar_rules").delete().eq("workspace_id", workspace.id).eq("id", body.id);
      if (error) throw error;
      return json(200, { ok: true });
    }
    return json(400, { ok: false, error: "unknown_action" });
  } catch (error) {
    console.error("[reservations-lab]", error);
    return json(400, { ok: false, error: (error as any).code || "request_failed", message: (error as Error).message });
  }
});
