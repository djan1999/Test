/**
 * digestivo.js — the digestivo service, as the kitchen hears about it.
 *
 * A digestivo is ordered like an aperitif (a quick-access button on the seat,
 * backed by a linked catalogue product) but it is served at a point in the
 * MENU rather than before it. Admin marks the course the digestivo goes out
 * ahead of — "Digestivo before this course" on, say, Buchtel — and every
 * ticket for a table whose guests ordered one then carries a DIGESTIVO
 * service line directly above that course, so the pass reads it in the order
 * the room will run it.
 *
 * Pure: no React, no storage. The seat's picks live in `seat.digestivos`, the
 * same one-entry-per-pour list shape every other drink category uses.
 */

import { groupDrinks, qtySuffix } from "./drinkQuantities.js";

/** The course key a ticket anchors the digestivo line above, normalised. */
export const digestivoCourseKey = (course) =>
  String(course?.course_key || "").trim().toLowerCase();

/** True when admin marked this course as the one digestivo is served before. */
export const courseAnchorsDigestivo = (course) =>
  course?.digestivo_before === true && course?.is_active !== false;

/**
 * Every course key the digestivo line is served above.
 *
 * A Set, and more than one anchor is allowed on purpose: a restaurant running
 * a short and a long menu marks the dessert course of each, and only the one
 * actually on this table's ticket ever matches.
 */
export const digestivoAnchorKeys = (menuCourses = []) => new Set(
  (menuCourses || [])
    .filter(courseAnchorsDigestivo)
    .map(digestivoCourseKey)
    .filter(Boolean),
);

/** True when THIS course is the one the digestivo line sits above. */
export const isDigestivoAnchor = (course, anchorKeys) => {
  const key = digestivoCourseKey(course);
  if (!key) return false;
  return anchorKeys instanceof Set
    ? anchorKeys.has(key)
    : digestivoAnchorKeys(anchorKeys).has(key);
};

/** One seat's digestivo picks as display names, rounds collapsed to "×n". */
export const seatDigestivoNames = (seat) =>
  groupDrinks(seat?.digestivos).map(({ item, qty }) =>
    `${String(item?.name || "").trim()}${qtySuffix(qty)}`.trim()).filter(Boolean);

/**
 * Per-seat digestivo orders across a table: [{ seatId, names: [...] }] for the
 * seats that ordered one, in seat order. Seats with nothing are left out —
 * the ticket line only exists for the chairs it names.
 */
export const digestivoSeatOrders = (seats = []) =>
  (Array.isArray(seats) ? seats : [])
    .map((seat) => ({ seatId: seat?.id, names: seatDigestivoNames(seat) }))
    .filter((entry) => entry.seatId != null && entry.names.length > 0);

/**
 * The single line the kitchen ticket prints: "P1 · Coffee ×2 · P3 · Grappa",
 * or null when nobody at the table ordered a digestivo (no order, no line).
 */
export const digestivoTicketLine = (seats = []) => {
  const orders = digestivoSeatOrders(seats);
  if (orders.length === 0) return null;
  return orders.map(({ seatId, names }) => `P${seatId} ${names.join(", ")}`).join(" · ");
};

/** How many digestivo pours the whole table ordered — the line's count badge. */
export const digestivoCount = (seats = []) =>
  (Array.isArray(seats) ? seats : [])
    .reduce((sum, seat) => sum + (Array.isArray(seat?.digestivos) ? seat.digestivos.length : 0), 0);
