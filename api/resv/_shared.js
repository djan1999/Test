import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { evaluateAvailability } from "../../src/domain/reservations/availability.js";
import {
  experiencesFor,
  normalizeReservationConfig,
  publicConfigOf,
} from "../../src/domain/reservations/config.js";
import { assertReservationTransition } from "../../src/domain/reservations/lifecycle.js";

const PRODUCTION_PROJECT_REF = "cvljktjmksfibuyphdln";
const LAB_WORKSPACE_SLUG = "milka-reservations-lab";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured for the reservations LAB.`);
  return value;
}

export function getAdminClient() {
  const url = requiredEnv("SUPABASE_URL");
  if (url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error("Reservations LAB refused to use the production Supabase project.");
  }
  const serviceKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || "",
  ).trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for the reservations LAB.");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.json(payload);
}

export function methodNotAllowed(response) {
  return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
}

function safeEqual(aValue, bValue) {
  const a = Buffer.from(String(aValue || ""));
  const b = Buffer.from(String(bValue || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function assertStaffAccess(request, client, { adminOnly = false } = {}) {
  const expectedCode = String(process.env.RESERVATIONS_LAB_ACCESS_CODE || "").trim();
  const receivedCode = String(request.headers["x-milka-lab-access"] || "");
  if (expectedCode && safeEqual(expectedCode, receivedCode)) {
    return { kind: "lab_code", role: "admin", userId: null, workspaceId: null };
  }

  const authorization = String(request.headers.authorization || "");
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const workspaceId = String(request.headers["x-milka-workspace-id"] || "").trim();
  if (!accessToken || !workspaceId) {
    const error = new Error("Sign in to Milka or enter the LAB access code.");
    error.statusCode = 401;
    throw error;
  }

  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  const userId = authData?.user?.id;
  if (authError || !userId) {
    const error = new Error("Your Milka login expired. Sign in again.");
    error.statusCode = 401;
    throw error;
  }
  const { data: membership, error: membershipError } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  const role = String(membership?.role || "").toLowerCase();
  const permitted = adminOnly ? role === "admin" : ["admin", "service"].includes(role);
  if (!permitted) {
    const error = new Error(adminOnly
      ? "Only a Milka Admin can change reservation settings."
      : "Your Milka role cannot manage reservations.");
    error.statusCode = 403;
    throw error;
  }
  return { kind: "milka_session", role, userId, workspaceId };
}

// Reservations belong to the workspace the caller is signed into — the
// membership for that id has just been proved above. Only the standalone LAB
// entry points (access code, public /book) carry no caller workspace, and they
// keep resolving the lab slug.
export async function getWorkspace(client, workspaceId = null) {
  const query = client.from("workspaces").select("id,slug,name");
  const { data, error } = await (workspaceId
    ? query.eq("id", workspaceId)
    : query.eq("slug", LAB_WORKSPACE_SLUG)).single();
  if (error) throw error;
  return data;
}

export function mapService(row) {
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

export function mapException(row) {
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

export function mapBooking(row) {
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

function bookingInsert(workspaceId, payload, extra = {}) {
  return {
    workspace_id: workspaceId,
    date: payload.date,
    service: payload.service,
    booking_time: payload.time,
    pax: Number(payload.pax),
    status: payload.status,
    guest_name: String(payload.name || "").trim(),
    phone: String(payload.phone || "").trim() || null,
    email: String(payload.email || "").trim().toLowerCase() || null,
    language: payload.language || "en",
    source: payload.source || "staff",
    ref: payload.ref,
    table_label: payload.tableLabel || null,
    experience: payload.experience || null,
    occasion: payload.occasion || null,
    notes: payload.notes || null,
    allergies: Array.isArray(payload.allergies) ? payload.allergies : [],
    accessibility: Array.isArray(payload.accessibility) ? payload.accessibility : [],
    consent_news: Boolean(payload.consentNews),
    operational_data: payload.operationalData && typeof payload.operationalData === "object"
      ? payload.operationalData
      : {},
    idempotency_key: payload.idempotencyKey || null,
    created_by: payload.actor || "SYSTEM",
    ...extra,
  };
}

export function validateBookingPayload(payload) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ""))) throw new Error("Choose a valid date.");
  if (!/^\d{2}:\d{2}$/.test(String(payload.time || ""))) throw new Error("Choose a valid time.");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(payload.service || ""))) throw new Error("Choose a valid service.");
  if (!String(payload.name || "").trim()) throw new Error("Guest name is required.");
  if (!Number.isInteger(Number(payload.pax)) || Number(payload.pax) < 1 || Number(payload.pax) > 30) {
    throw new Error("Party size must be between 1 and 30.");
  }
}

export async function loadReservationContext(client, workspaceId, { from, to } = {}) {
  const [configResult, servicesResult, rulesResult, bookingsResult] = await Promise.all([
    // maybeSingle: a workspace that has never saved reservation settings reads
    // as the defaults rather than failing the whole staff load.
    client.from("reservation_config").select("config,version,updated_at").eq("workspace_id", workspaceId).maybeSingle(),
    client.from("reservation_services").select("*").eq("workspace_id", workspaceId).order("weekday").order("first_seating"),
    client.from("reservation_calendar_rules").select("*").eq("workspace_id", workspaceId).order("date"),
    (() => {
      let query = client.from("reservation_bookings").select("*").eq("workspace_id", workspaceId).order("date").order("booking_time");
      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);
      return query;
    })(),
  ]);
  for (const result of [configResult, servicesResult, rulesResult, bookingsResult]) {
    if (result.error) throw result.error;
  }
  return {
    config: normalizeReservationConfig(configResult.data?.config),
    configVersion: Number(configResult.data?.version || 1),
    services: (servicesResult.data || []).map(mapService),
    exceptions: (rulesResult.data || []).map(mapException),
    bookings: (bookingsResult.data || []).map(mapBooking),
  };
}

function restaurantClock(timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).reduce((values, part) => ({ ...values, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

export async function getAvailability(client, workspaceId, {
  date,
  pax,
  publicOnly,
  excludeBookingId = null,
}) {
  const context = await loadReservationContext(client, workspaceId, { from: date, to: date });
  const now = restaurantClock(context.config.timezone || "Europe/Ljubljana");
  // The booking window is the server's to enforce, never the browser's: a
  // public request for a past date, or one beyond online.windowDays, is offered
  // nothing at all. Mirrors the edge function so both servers agree.
  const outsideWindow = Boolean(publicOnly) && (
    date < now.date || date > shiftDate(now.date, context.config.online.windowDays)
  );
  // Online booking switched off closes /book at the server, not merely in the
  // guest's browser: the switch has to hold against a hand-made request too.
  const onlineClosed = Boolean(publicOnly) && context.config.online.enabled === false;
  const services = (outsideWindow || onlineClosed) ? [] : evaluateAvailability({
    date,
    pax: Number(pax),
    services: context.services,
    exceptions: context.exceptions,
    bookings: context.bookings.filter((booking) => booking.id !== excludeBookingId),
    config: context.config,
    publicOnly,
    isToday: publicOnly && date === now.date,
    nowMinutes: publicOnly ? now.minutes : null,
  });
  return { ...context, services, outsideWindow, onlineClosed };
}

export function createReference() {
  const stamp = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `MK-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function createManageToken() {
  const raw = crypto.randomBytes(24).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export async function createBooking(client, workspaceId, input, { publicOnly = false } = {}) {
  validateBookingPayload(input);
  const idempotencyKey = String(input.idempotencyKey || "").trim() || crypto.randomUUID();
  const { data: replay, error: replayError } = await client
    .from("reservation_bookings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (replayError) throw replayError;
  if (replay) {
    let manageToken = null;
    if (publicOnly) {
      manageToken = createManageToken();
      const expiry = new Date(`${replay.date}T23:59:59+02:00`);
      expiry.setDate(expiry.getDate() + 1);
      const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
        token_hash: manageToken.hash,
        workspace_id: workspaceId,
        booking_id: replay.id,
        expires_at: expiry.toISOString(),
      });
      if (tokenError) throw tokenError;
    }
    return {
      booking: mapBooking(replay),
      replay: true,
      manageToken: manageToken?.raw || null,
    };
  }

  // Staff rules, not public rules, decide a staff write: a host takes a table
  // by telephone on a closed day, seats a walk-in of eight, or accepts an
  // overbook the manager approved. The server still validates the payload and
  // still computes the slot (for the table suggestion), and the override is
  // recorded below rather than waved through silently.
  const { availability, slot, overrideReason } = await validateBookingChoice(
    client,
    workspaceId,
    input,
    { publicOnly, allowOverride: Boolean(input.overrideReason) || !publicOnly },
  );

  const status = input.status || (
    publicOnly && Number(input.pax) > Number(availability.config.online.autoConfirmMaxPax)
      ? "pending"
      : "confirmed"
  );
  const ref = createReference();
  const record = bookingInsert(workspaceId, {
    ...input,
    status,
    ref,
    idempotencyKey,
    tableLabel: publicOnly
      ? (slot?.tableLabel || input.tableLabel)
      : (input.tableLabel || slot?.tableLabel),
    operationalData: {
      ...(input.operationalData || {}),
      tableGroup: input.operationalData?.tableGroup || slot?.tables || (
        input.tableLabel ? [input.tableLabel] : []
      ),
    },
  });
  const rpcBooking = {
    id: input.id,
    date: record.date,
    service: record.service,
    time: input.time,
    pax: record.pax,
    status: record.status,
    name: record.guest_name,
    phone: record.phone || "",
    email: record.email || "",
    language: record.language,
    source: record.source,
    ref: record.ref,
    tableLabel: record.table_label,
    experience: record.experience || "",
    occasion: record.occasion || "",
    notes: record.notes || "",
    allergies: record.allergies,
    accessibility: record.accessibility,
    consentNews: record.consent_news,
    idempotencyKey: record.idempotency_key,
    createdBy: record.created_by,
    operationalData: record.operational_data,
  };
  const { data: savedRows, error } = await client.rpc("save_reservation_booking_rows", {
    p_workspace: workspaceId,
    p_bookings: [rpcBooking],
    p_actor: input.actor || (publicOnly ? "WEB" : "LAB STAFF"),
  });
  if (error) {
    if (error.code === "23505") {
      const { data: duplicate } = await client
        .from("reservation_bookings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      let duplicateToken = null;
      if (publicOnly) {
        duplicateToken = createManageToken();
        const expiry = new Date(`${duplicate.date}T23:59:59+02:00`);
        expiry.setDate(expiry.getDate() + 1);
        const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
          token_hash: duplicateToken.hash,
          workspace_id: workspaceId,
          booking_id: duplicate.id,
          expires_at: expiry.toISOString(),
        });
        if (tokenError) throw tokenError;
      }
      return {
        booking: mapBooking(duplicate),
        replay: true,
        manageToken: duplicateToken?.raw || null,
      };
    }
    if (String(error.message || "").includes("slot_taken")) error.code = "slot_taken";
    throw error;
  }
  const data = savedRows?.[0];
  if (!data) throw new Error("Reservation write returned no booking.");

  let manageToken = null;
  if (publicOnly) {
    manageToken = createManageToken();
    const expiry = new Date(`${input.date}T23:59:59+02:00`);
    expiry.setDate(expiry.getDate() + 1);
    const { error: tokenError } = await client.from("reservation_manage_tokens").insert({
      token_hash: manageToken.hash,
      workspace_id: workspaceId,
      booking_id: data.id,
      expires_at: expiry.toISOString(),
    });
    if (tokenError) throw tokenError;
  }
  if (overrideReason) {
    const { error: eventError } = await client.from("reservation_status_events").insert({
      workspace_id: workspaceId,
      booking_id: data.id,
      actor: input.actor || (publicOnly ? "WEB" : "LAB STAFF"),
      event_type: "override",
      to_status: data.status,
      reason: String(input.overrideReason || "").trim()
        || `Taken outside availability (${overrideReason}).`,
    });
    if (eventError) throw eventError;
  }
  await upsertGuest(client, workspaceId, mapBooking(data));
  return { booking: mapBooking(data), replay: false, manageToken: manageToken?.raw || null };
}

export async function validateBookingChoice(client, workspaceId, input, {
  publicOnly = true,
  excludeBookingId = null,
  allowOverride = false,
} = {}) {
  validateBookingPayload(input);
  const availability = await getAvailability(client, workspaceId, {
    date: input.date,
    pax: Number(input.pax),
    publicOnly,
    excludeBookingId,
  });
  if (availability.onlineClosed) {
    const error = new Error("Online booking is closed. Please telephone the restaurant.");
    error.code = "online_closed";
    throw error;
  }
  if (availability.outsideWindow) {
    const error = new Error("That date is outside the online booking window.");
    error.code = "outside_window";
    throw error;
  }
  // Step 4 of the resolution order — experience restrictions — before any
  // capacity rule: an experience the restaurant curates may only be booked on a
  // service that offers it. Free text a host typed matches no configured key
  // and stays unrestricted, as bookings have always recorded it that way.
  const requested = String(input.experience || "").trim();
  const curated = requested && availability.config.experiences.some((item) => item.key === requested);
  if (curated && !allowOverride
      && !experiencesFor(input.service, availability.config).some((item) => item.key === requested)) {
    const error = new Error("That menu is not served at this time.");
    error.code = "not_offered";
    throw error;
  }
  if (publicOnly && Number(input.pax) > Number(availability.config.online.maxPax)) {
    const error = new Error("This party is too large for online booking.");
    error.code = "party_too_large";
    throw error;
  }
  const service = availability.services.find((item) => item.service === input.service);
  const candidate = service?.slots.find((item) => item.time === input.time);
  const slot = candidate?.ok ? candidate : null;
  if (!slot && !allowOverride) {
    const error = new Error(candidate?.reason === "no_table"
      ? "No table of the right size is free then."
      : "That time is no longer available.");
    error.code = candidate?.reason === "no_table" ? "no_table" : (
      candidate?.reason === "party_too_large" ? "party_too_large" : "slot_taken"
    );
    throw error;
  }
  return {
    availability,
    slot,
    // Why the slot was refused, so an override that records the booking anyway
    // can say so in the booking's history.
    overrideReason: slot ? null : (candidate?.reason || "unavailable"),
    status: input.status || (
      publicOnly && Number(input.pax) > Number(availability.config.online.autoConfirmMaxPax)
        ? "pending"
        : "confirmed"
    ),
  };
}

export async function upsertGuest(client, workspaceId, booking) {
  const contact = booking.email || booking.phone || booking.name;
  const nameKey = `${String(booking.name).trim().toLowerCase()}|${String(contact).trim().toLowerCase()}`;
  const { data: existing, error } = await client
    .from("reservation_guests")
    .select("id,visit_count")
    .eq("workspace_id", workspaceId)
    .eq("name_key", nameKey)
    .maybeSingle();
  if (error) throw error;
  const row = {
    workspace_id: workspaceId,
    name_key: nameKey,
    name: booking.name,
    phone: booking.phone || null,
    email: booking.email || null,
    language: booking.language || "en",
    visit_count: Number(existing?.visit_count || 0) + (booking.status === "completed" ? 1 : 0),
    last_visit: booking.status === "completed" ? booking.date : null,
    updated_at: new Date().toISOString(),
  };
  if (existing) return client.from("reservation_guests").update(row).eq("id", existing.id);
  return client.from("reservation_guests").insert(row);
}

export async function transitionBooking(client, workspaceId, bookingId, toStatus, reason, actor) {
  const { data: current, error } = await client
    .from("reservation_bookings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  assertReservationTransition(current.status, toStatus, reason);
  const { data, error: updateError } = await client
    .from("reservation_bookings")
    .update({ status: toStatus, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", bookingId)
    .eq("status", current.status)
    .select("*")
    .single();
  if (updateError) throw updateError;
  await client.from("reservation_status_events").insert({
    workspace_id: workspaceId,
    booking_id: bookingId,
    actor,
    event_type: "status_changed",
    from_status: current.status,
    to_status: toStatus,
    reason: reason || null,
  });
  if (toStatus === "completed") await upsertGuest(client, workspaceId, mapBooking(data));
  return mapBooking(data);
}

export async function resolveManageToken(client, rawToken) {
  const hash = crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
  const { data: token, error } = await client
    .from("reservation_manage_tokens")
    .select("booking_id,expires_at,revoked_at,workspace_id")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw error;
  if (!token || token.revoked_at || new Date(token.expires_at) < new Date()) return null;
  const { data: booking, error: bookingError } = await client
    .from("reservation_bookings")
    .select("*")
    .eq("id", token.booking_id)
    .single();
  if (bookingError) throw bookingError;
  return { tokenHash: hash, workspaceId: token.workspace_id, booking: mapBooking(booking) };
}

export function publicConfig(config) {
  return publicConfigOf(config);
}
