const ALLOWED_SOURCES = new Set(["staff", "web", "phone", "walk_in", "waitlist"]);

export function tableLabelToId(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function tableIdToLabel(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? `T${String(id).padStart(2, "0")}` : null;
}

function normalizeSource(value) {
  const source = String(value || "staff");
  return ALLOWED_SOURCES.has(source) ? source : "staff";
}

function tableIdsFromBooking(booking) {
  const operational = booking?.operationalData || {};
  const group = Array.isArray(operational.tableGroup) ? operational.tableGroup : [];
  const ids = group.map(tableLabelToId).filter(Boolean);
  const primary = tableLabelToId(booking?.tableLabel);
  if (ids.length) return [...new Set(ids)].sort((a, b) => a - b);
  return primary ? [primary] : [];
}

export function bookingToLegacyReservation(booking) {
  const operational = booking?.operationalData && typeof booking.operationalData === "object"
    ? booking.operationalData
    : {};
  const tableGroup = tableIdsFromBooking(booking);
  const restrictions = Array.isArray(operational.restrictions)
    ? operational.restrictions
    : (Array.isArray(booking?.allergies) ? booking.allergies : []);
  return {
    id: booking.id,
    date: booking.date,
    table_id: tableGroup[0] || null,
    created_at: booking.createdAt || booking.created_at,
    data: {
      ...operational,
      reservation_v2: true,
      booking_status: booking.status || "confirmed",
      service_session: booking.service || "dinner",
      resName: booking.name || "",
      resTime: booking.time || "",
      guests: Number(booking.pax || 0),
      lang: booking.language || "en",
      phone: booking.phone || "",
      email: booking.email || "",
      source: normalizeSource(booking.source),
      ref: booking.ref || "",
      experience: booking.experience || "",
      occasion: booking.occasion || "",
      notes: booking.notes || "",
      restrictions,
      accessibility: Array.isArray(booking.accessibility) ? booking.accessibility : [],
      consentNews: Boolean(booking.consentNews),
      tableGroup,
    },
  };
}

export function legacyReservationToBooking(row, existing = {}) {
  const data = row?.data && typeof row.data === "object" ? row.data : {};
  const rawGroup = Array.isArray(data.tableGroup) && data.tableGroup.length
    ? data.tableGroup
    : (row?.table_id != null ? [row.table_id] : []);
  const tableLabels = rawGroup
    .map((value) => tableIdToLabel(tableLabelToId(value)))
    .filter(Boolean);
  const source = normalizeSource(data.source || existing.source);
  return {
    id: row?.id || existing.id,
    date: row?.date || existing.date,
    service: data.service_session || existing.service || "dinner",
    time: data.resTime || existing.time || "",
    pax: Number(data.guests || existing.pax || 1),
    status: data.booking_status || existing.status || "confirmed",
    name: data.resName || existing.name || "Reservation",
    phone: data.phone ?? existing.phone ?? "",
    email: data.email ?? existing.email ?? "",
    language: data.lang || existing.language || "en",
    source,
    ref: data.ref || existing.ref || "",
    tableLabel: tableLabels[0] || tableIdToLabel(row?.table_id) || existing.tableLabel || null,
    experience: data.experience ?? existing.experience ?? "",
    occasion: data.occasion ?? existing.occasion ?? "",
    notes: data.notes ?? existing.notes ?? "",
    allergies: Array.isArray(data.restrictions)
      ? data.restrictions
      : (Array.isArray(existing.allergies) ? existing.allergies : []),
    accessibility: Array.isArray(data.accessibility)
      ? data.accessibility
      : (Array.isArray(existing.accessibility) ? existing.accessibility : []),
    consentNews: data.consentNews ?? existing.consentNews ?? false,
    idempotencyKey: existing.idempotencyKey,
    createdBy: existing.createdBy,
    operationalData: {
      ...data,
      tableGroup: tableLabels,
    },
  };
}

export function activeLegacyReservations(bookings) {
  return (bookings || [])
    .filter((booking) => ["pending", "confirmed", "arrived"].includes(booking.status))
    .map(bookingToLegacyReservation);
}
