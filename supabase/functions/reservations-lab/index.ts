import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-milka-lab-access",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const activeStatuses = new Set(["pending", "confirmed", "arrived"]);
const transitions: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["completed", "confirmed"],
  completed: [],
  cancelled: ["pending"],
  no_show: ["confirmed"],
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...cors, "Cache-Control": "no-store" } });

const minutesOf = (time: string) => {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
};
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const slotsBetween = (first: string, last: string, interval: number) => {
  const slots: string[] = [];
  for (let at = minutesOf(first); at <= minutesOf(last); at += interval) slots.push(timeOf(at));
  return slots;
};
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const restaurantNow = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function durationForParty(pax: number, config: Record<string, any>) {
  if (pax <= 2) return Number(config.durations?.small || 120);
  if (pax <= 5) return Number(config.durations?.medium || 150);
  return Number(config.durations?.large || 180);
}

function resolveServices(date: string, services: any[], rules: any[], publicOnly = false) {
  const weekday = weekdayOf(date);
  const dayRules = rules.filter((rule) => rule.date === date);
  if (dayRules.some((rule) => ["closed", "private_event"].includes(rule.kind))) return [];
  const overrides = new Map(dayRules.filter((rule) => rule.kind === "service_override" && rule.service).map((rule) => [rule.service, rule]));
  const names = new Set([...services.map((item) => item.service), ...overrides.keys()]);
  return [...names].flatMap((serviceName) => {
    const weekly = services.find((item) => item.service === serviceName && Number(item.weekday) === weekday);
    const override: any = overrides.get(serviceName);
    if (override?.mode === "off" || (!weekly?.enabled && override?.mode !== "on")) return [];
    const resolved = {
      service: serviceName,
      first: override?.first || weekly?.first || (serviceName === "lunch" ? "12:00" : "18:00"),
      last: override?.last || weekly?.last || (serviceName === "lunch" ? "13:30" : "19:30"),
      interval: Number(override?.interval || weekly?.interval || 30),
      onlineEnabled: override?.onlineOff ? false : weekly?.onlineEnabled !== false,
    };
    return publicOnly && !resolved.onlineEnabled ? [] : [resolved];
  }).sort((a, b) => minutesOf(a.first) - minutesOf(b.first));
}

function tableFor(date: string, time: string, pax: number, bookings: any[], config: Record<string, any>) {
  const start = minutesOf(time);
  const end = start + durationForParty(pax, config) + Number(config.durations?.buffer || 15);
  const occupied = bookings.filter((booking) => {
    if (booking.date !== date || !activeStatuses.has(booking.status) || !booking.tableLabel) return false;
    const otherStart = minutesOf(booking.time);
    const otherEnd = otherStart + durationForParty(booking.pax, config) + Number(config.durations?.buffer || 15);
    return start < otherEnd && otherStart < end;
  });
  return [...(config.tables || [])]
    .filter((table) => Number(table.seats) >= pax)
    .sort((a, b) => Number(a.seats) - Number(b.seats))
    .find((table) => !occupied.some((booking) => booking.tableLabel === table.id))?.id || null;
}

function availability(date: string, pax: number, context: any, publicOnly = false) {
  if (publicOnly) {
    const now = restaurantNow();
    const max = new Date(`${now.date}T12:00:00Z`);
    max.setUTCDate(max.getUTCDate() + Number(context.config.online?.windowDays || 90));
    if (date < now.date || date > max.toISOString().slice(0, 10)) return [];
  }
  const dayServices = resolveServices(date, context.services, context.exceptions, publicOnly);
  const active = context.bookings.filter((booking) => booking.date === date && activeStatuses.has(booking.status));
  const capacityRule = context.exceptions.find((rule) => rule.date === date && rule.kind === "capacity_override");
  const serviceCap = Number(capacityRule?.capacity || context.config.pacing?.coversPerService || 44);
  return dayServices.map((service) => {
    const inService = active.filter((booking) => booking.service === service.service);
    const serviceCovers = inService.reduce((total, booking) => total + booking.pax, 0);
    return {
      ...service,
      slots: slotsBetween(service.first, service.last, service.interval).map((time) => {
        const slotCovers = inService.filter((booking) => booking.time === time).reduce((total, booking) => total + booking.pax, 0);
        const tableLabel = tableFor(date, time, pax, active, context.config);
        const now = publicOnly ? restaurantNow() : null;
        const passesLeadTime = !publicOnly
          || date !== now?.date
          || minutesOf(time) >= Number(now?.minutes || 0) + Number(context.config.online?.leadMinutes || 0);
        const ok = passesLeadTime
          && serviceCovers + pax <= serviceCap
          && slotCovers + pax <= Number(context.config.pacing?.coversPerSlot || 12)
          && Boolean(tableLabel);
        return { time, ok, tableLabel: ok ? tableLabel : null };
      }),
    };
  });
}

function validateBooking(input: Record<string, any>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))) throw new Error("Choose a valid date.");
  if (!/^\d{2}:\d{2}$/.test(String(input.time || ""))) throw new Error("Choose a valid time.");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(input.service || ""))) throw new Error("Choose a valid service.");
  if (!String(input.name || "").trim()) throw new Error("Guest name is required.");
  if (!Number.isInteger(Number(input.pax)) || Number(input.pax) < 1 || Number(input.pax) > 30) throw new Error("Party size must be between 1 and 30.");
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
      "updateWaitlist", "saveConfig", "saveSchedule", "saveCalendarRule", "deleteCalendarRule",
    ]);
    if (staffActions.has(action)) {
      const code = String(request.headers.get("x-milka-lab-access") || body.accessCode || "");
      const { data: auth, error: authError } = await client.from("reservation_lab_auth").select("access_code_hash").eq("workspace_id", workspace.id).single();
      if (authError) throw authError;
      if (!code || await sha256(code) !== auth.access_code_hash) return json(401, { ok: false, error: "invalid_lab_access", message: "LAB access code is invalid." });
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

    const createBooking = async (input: any, publicOnly: boolean) => {
      validateBooking(input);
      const idempotencyKey = String(input.idempotencyKey || crypto.randomUUID());
      const { data: replay, error: replayError } = await client.from("reservation_bookings").select("*").eq("workspace_id", workspace.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (replayError) throw replayError;
      if (replay) return { booking: mapBooking(replay), replay: true, token: null };
      const context = await loadContext(input.date);
      const options = availability(input.date, Number(input.pax), context, publicOnly);
      const service = options.find((item) => item.service === input.service);
      const slot = service?.slots.find((item) => item.time === input.time && item.ok);
      if (!slot && !input.overrideReason) {
        const error: any = new Error("That time is no longer available.");
        error.code = "slot_taken";
        throw error;
      }
      if (publicOnly && Number(input.pax) > Number(context.config.online?.maxPax || 6)) {
        const error: any = new Error("This party is too large for online booking.");
        error.code = "party_too_large";
        throw error;
      }
      const status = input.status || (publicOnly && Number(input.pax) > Number(context.config.online?.autoConfirmMaxPax || 4) ? "pending" : "confirmed");
      const ref = randomRef();
      const { data, error } = await client.from("reservation_bookings").insert({
        workspace_id: workspace.id,
        date: input.date,
        service: input.service,
        booking_time: input.time,
        pax: Number(input.pax),
        status,
        guest_name: String(input.name).trim(),
        phone: String(input.phone || "").trim() || null,
        email: String(input.email || "").trim().toLowerCase() || null,
        language: input.language || "en",
        source: input.source || (publicOnly ? "web" : "staff"),
        ref,
        table_label: slot?.tableLabel || input.tableLabel || null,
        experience: input.experience || null,
        occasion: input.occasion || null,
        notes: input.notes || null,
        allergies: Array.isArray(input.allergies) ? input.allergies : [],
        accessibility: Array.isArray(input.accessibility) ? input.accessibility : [],
        consent_news: Boolean(input.consentNews),
        idempotency_key: idempotencyKey,
        created_by: publicOnly ? "WEB" : "LAB STAFF",
      }).select("*").single();
      if (error) throw error;
      const booking = mapBooking(data);
      await event(data.id, { actor: publicOnly ? "WEB" : "LAB STAFF", event_type: "created", to_status: status });
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
      const config = context.config;
      return json(200, { ok: true, config: {
        restaurantName: config.restaurantName,
        tagline: config.tagline,
        timezone: config.timezone,
        online: { enabled: config.online?.enabled, maxPax: config.online?.maxPax, windowDays: config.online?.windowDays },
        publicPage: config.publicPage,
        waitlistEnabled: config.waitlist?.enabled,
      } });
    }
    if (action === "availability") {
      const context = await loadContext(body.date);
      const services = availability(body.date, Number(body.pax || 2), context, true)
        .map((service) => ({ service: service.service, slots: service.slots.map(({ time, ok }) => ({ time, ok })) }));
      return json(200, { ok: true, services, anyOk: services.some((service) => service.slots.some((slot) => slot.ok)) });
    }
    if (action === "submit") {
      const result = await createBooking({ ...body.booking, idempotencyKey: body.idempotencyKey, source: "web" }, true);
      const origin = request.headers.get("origin") || "";
      return json(200, { ok: true, ref: result.booking.ref, status: result.booking.status, manageUrl: result.token ? `${origin}/book/manage/${result.token}` : null, replay: result.replay });
    }
    if (action === "waitlist") {
      const entry = body.entry || {};
      if (!entry.date || !entry.name || !Number(entry.pax)) throw new Error("Date, name and party size are required.");
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
      return json(200, { ok: true, booking: { ref: booking.ref, date: booking.date, service: booking.service, time: booking.time, pax: booking.pax, name: booking.name, status: booking.status } });
    }
    if (action === "cancel") {
      const managed = await resolveToken(body.token);
      if (!managed) return json(404, { ok: false, error: "expired_link" });
      if (!transitions[managed.booking.status]?.includes("cancelled")) throw new Error("This reservation cannot be cancelled.");
      const { error } = await client.from("reservation_bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", managed.booking.id);
      if (error) throw error;
      await event(managed.booking.id, { actor: "WEB", event_type: "status_changed", from_status: managed.booking.status, to_status: "cancelled", reason: body.reason || "Cancelled by guest" });
      await client.from("reservation_manage_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", managed.hash);
      return json(200, { ok: true, status: "cancelled" });
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
      validateBooking(booking);
      const { data, error } = await client.from("reservation_bookings").update({
        date: booking.date, service: booking.service, booking_time: booking.time,
        pax: Number(booking.pax), guest_name: booking.name, phone: booking.phone || null,
        email: booking.email || null, language: booking.language || "en",
        experience: booking.experience || null, occasion: booking.occasion || null,
        notes: booking.notes || null, allergies: booking.allergies || [],
        accessibility: booking.accessibility || [], updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspace.id).eq("id", booking.id).select("*").single();
      if (error) throw error;
      await event(booking.id, { actor: "LAB STAFF", event_type: "modified" });
      return json(200, { ok: true, booking: mapBooking(data) });
    }
    if (action === "transition") {
      const { data: current, error: currentError } = await client.from("reservation_bookings").select("*").eq("workspace_id", workspace.id).eq("id", body.bookingId).single();
      if (currentError) throw currentError;
      if (!transitions[current.status]?.includes(body.toStatus)) throw new Error(`Reservation cannot move from ${current.status} to ${body.toStatus}.`);
      if (["cancelled", "no_show"].includes(body.toStatus) && !String(body.reason || "").trim()) throw new Error("A reason is required.");
      const { data, error } = await client.from("reservation_bookings").update({ status: body.toStatus, updated_at: new Date().toISOString() }).eq("id", current.id).eq("status", current.status).select("*").single();
      if (error) throw error;
      await event(current.id, { actor: "LAB STAFF", event_type: "status_changed", from_status: current.status, to_status: body.toStatus, reason: body.reason || null });
      const booking = mapBooking(data);
      if (body.toStatus === "completed") await upsertGuest(booking);
      return json(200, { ok: true, booking });
    }
    if (action === "addWaitlist") {
      const entry = body.entry || {};
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
    if (action === "saveConfig") {
      const { data: before, error: beforeError } = await client.from("reservation_config").select("config,version").eq("workspace_id", workspace.id).single();
      if (beforeError) throw beforeError;
      const { error } = await client.from("reservation_config").update({ config: body.config, version: Number(before.version || 1) + 1, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id);
      if (error) throw error;
      await client.from("reservation_admin_audit").insert({ workspace_id: workspace.id, actor: "LAB STAFF", section: "Reservations", field: "configuration", old_value: before.config, new_value: body.config });
      return json(200, { ok: true, version: Number(before.version || 1) + 1 });
    }
    if (action === "saveSchedule") {
      const { error: deleteError } = await client.from("reservation_services").delete().eq("workspace_id", workspace.id);
      if (deleteError) throw deleteError;
      const rows = (Array.isArray(body.services) ? body.services : []).filter((row) => row.enabled).map((row) => ({
        workspace_id: workspace.id, service: row.service, weekday: Number(row.weekday), enabled: true,
        first_seating: row.first, last_seating: row.last, interval_min: Number(row.interval || 30),
        online_enabled: row.onlineEnabled !== false,
      }));
      if (rows.length) {
        const { error } = await client.from("reservation_services").insert(rows);
        if (error) throw error;
      }
      await client.from("reservation_admin_audit").insert({ workspace_id: workspace.id, actor: "LAB STAFF", section: "Services & Hours", field: "weekly schedule", new_value: body.services });
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
