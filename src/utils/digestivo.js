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
 * A button can carry SUBCATEGORIES — "Coffee" scrolling through espresso,
 * cappuccino, macchiato — the way the pairing button scrolls its types. The
 * chosen one is folded into the stored entry's `name`, so two subcategories of
 * one button are two different drinks everywhere downstream: the ×n grouping,
 * the ticket line, the archive counts. `baseName` and `variant` ride alongside
 * purely so the button can find its own picks again and show which one is on.
 *
 * Pure: no React, no storage. The seat's picks live in `seat.digestivos`, the
 * same one-entry-per-pour list shape every other drink category uses.
 */

import { groupDrinks, qtySuffix } from "./drinkQuantities.js";
import { aperitifMatchesQuickAccessOption, resolveAperitifFromQuickAccessOption } from "./quickAccessResolve.js";

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

// ── Subcategories ────────────────────────────────────────────────────────────
// A digestivo button is configured with zero or more subcategory labels. With
// none it is a plain on/off toggle, exactly as before. With some, it scrolls:
//
//   off → Espresso → Cappuccino → Macchiato → off
//
// the same shape as the pairing button's cycle, so the gesture is one the
// floor already knows.

/**
 * The configured subcategories of a button, cleaned and de-duplicated.
 *
 * Each one carries its OWN catalogue link, because the category does not name
 * a product: "Coffee" is not something the bar can pour, "Espresso – Banibeans"
 * is. Older configs stored a bare string per subcategory; those still read, they
 * simply have nothing linked yet.
 */
export const digestivoVariantOptions = (opt) => {
  const seen = new Set();
  return (Array.isArray(opt?.variants) ? opt.variants : [])
    .map((v) => (typeof v === "string"
      ? { label: v.trim() }
      : {
          label: String(v?.label ?? "").trim(),
          ...(v?.type ? { type: v.type } : {}),
          ...(v?.searchKey ? { searchKey: v.searchKey } : {}),
          ...(v?.linkedKey ? { linkedKey: v.linkedKey } : {}),
        }))
    .filter((v) => {
      if (!v.label) return false;
      const key = v.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** Just the labels — what the cycle, the picker and the stored name work in. */
export const digestivoVariants = (opt) => digestivoVariantOptions(opt).map((v) => v.label);

/** The configured subcategory a chosen label refers to, or null. */
export const digestivoVariantFor = (opt, label) => {
  const wanted = String(label ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return digestivoVariantOptions(opt).find((v) => v.label.toLowerCase() === wanted) || null;
};

/**
 * The catalogue product behind one digestivo pick.
 *
 * A button WITH subcategories is a grouping, and only the subcategory names a
 * product — so the parent's own link is not consulted at all. Consulting it is
 * what used to hand a "Tea" group whatever the wine list had that looked like
 * the word. A button with NO subcategories is a plain button and still links
 * directly, which is how a Grappa button reaches its grappa.
 */
export const resolveDigestivoProduct = (opt, variant, catalogs = {}) => {
  const variants = digestivoVariantOptions(opt);
  if (variants.length === 0) return resolveAperitifFromQuickAccessOption(opt, catalogs);
  const chosen = digestivoVariantFor(opt, variant);
  if (!chosen) return null;
  if (!chosen.linkedKey && !chosen.searchKey) return null;
  return resolveAperitifFromQuickAccessOption({
    label: chosen.label,
    searchKey: chosen.searchKey || chosen.label,
    linkedKey: chosen.linkedKey,
    type: chosen.type || "coffee",
  }, catalogs);
};

/**
 * The states the button scrolls through. Always starts at "off"; a button with
 * no subcategories has the single "on" state it has always had.
 */
export const digestivoCycleStates = (opt) => {
  const variants = digestivoVariants(opt);
  return ["off", ...(variants.length ? variants : ["on"])];
};

/** The name a stored pick shows everywhere: "Coffee (Espresso)", or "Grappa". */
export const digestivoDisplayName = (baseName, variant) => {
  const base = String(baseName ?? "").trim();
  const sub = String(variant ?? "").trim();
  if (!base) return sub;
  return sub ? `${base} (${sub})` : base;
};

/**
 * Whether a stored pick came from this button.
 *
 * The button's own id is checked first — it survives a product being re-linked
 * or a subcategory being renamed. The fuzzy catalogue match is the fallback for
 * entries stored before ids existed, and it is given `baseName` so a pick that
 * folded a subcategory into its name ("Coffee (Espresso)") still matches the
 * "Coffee" the button is configured with.
 */
export const digestivoEntryMatchesOption = (entry, opt, catalogs = {}) => {
  if (!entry) return false;
  if (entry.digestivoId != null && opt?.id != null) return entry.digestivoId === opt.id;
  const base = { ...entry, name: entry.baseName || entry.name };
  return aperitifMatchesQuickAccessOption(base, opt, catalogs);
};

/** Which state this button is showing for this seat: "off", "on", or a variant. */
export const digestivoCurrentState = (seat, opt, catalogs = {}) => {
  const mine = (seat?.digestivos || []).filter((e) => digestivoEntryMatchesOption(e, opt, catalogs));
  if (mine.length === 0) return "off";
  const variant = String(mine[mine.length - 1]?.variant ?? "").trim();
  if (!variant) return "on";
  // A variant that admin has since deleted would strand the button mid-cycle
  // with no way back, so an unknown one reads as plain "on".
  return digestivoCycleStates(opt).includes(variant) ? variant : "on";
};

/** The state one tap moves to, wrapping back to "off" past the last one. */
export const digestivoNextState = (seat, opt, catalogs = {}) => {
  const states = digestivoCycleStates(opt);
  const cur = digestivoCurrentState(seat, opt, catalogs);
  const idx = states.indexOf(cur);
  return states[(idx < 0 ? 0 : idx + 1) % states.length];
};

/**
 * One stored digestivo pick.
 *
 * `name` carries the subcategory so every downstream reader — the ×n grouping,
 * the ticket line, the archive — sees two subcategories of one button as two
 * different drinks. `baseName`, `variant` and `digestivoId` ride alongside so
 * the button that wrote it can find its own picks again. Every surface that
 * records a digestivo builds one through here, or they drift.
 */
export const digestivoEntry = (item, { baseName, variant = null, optionId = null } = {}) => {
  const base = String(baseName ?? item?.name ?? "").trim();
  const sub = String(variant ?? "").trim() || null;
  return {
    ...(item || { notes: "", __cocktail: true }),
    name: digestivoDisplayName(base, sub),
    baseName: base,
    ...(sub ? { variant: sub } : {}),
    ...(optionId != null ? { digestivoId: optionId } : {}),
  };
};

/**
 * The seat's digestivo list with this button set to ONE exact choice.
 *
 * `variant` is a subcategory label, "on" for a button that carries none, or
 * null to clear. Every pick belonging to this button is replaced, never
 * appended to: moving from espresso to decaf is one guest changing their mind,
 * not a second coffee. Quantities still come from the table sheet's counter,
 * as they do for every other drink.
 */
export const setSeatDigestivo = (seat, opt, resolvedItem, variant, catalogs = {}) => {
  const kept = (seat?.digestivos || []).filter((e) => !digestivoEntryMatchesOption(e, opt, catalogs));
  if (variant == null || variant === "off") return kept;
  return [...kept, digestivoEntry(resolvedItem, {
    baseName: resolvedItem?.name || opt?.label,
    variant: variant === "on" ? null : variant,
    optionId: opt?.id,
  })];
};

/**
 * The seat's digestivo list after one tap of a button with NO subcategories —
 * a plain off → on → off toggle. A button that HAS them opens the picker
 * instead (components/service/DigestivoPicker), where every option is on
 * screen at once rather than five taps apart.
 */
export const cycleSeatDigestivo = (seat, opt, resolvedItem, catalogs = {}) =>
  setSeatDigestivo(seat, opt, resolvedItem, digestivoNextState(seat, opt, catalogs), catalogs);

/**
 * The seat's digestivo list after a drink picked from the beverage SEARCH
 * rather than from a configured button.
 *
 * Appended, never replaced. The search is how the floor reaches a bottle
 * nobody put on a button, and two searched drinks are two digestivos — not one
 * guest scrolling a cycle, which is the only thing `cycleSeatDigestivo`
 * replaces. It carries no `digestivoId` because it belongs to no button, and
 * its own name as `baseName`, so a button linked to the same product still
 * recognises it as its own.
 */
export const addSeatDigestivo = (seat, item) => {
  const current = Array.isArray(seat?.digestivos) ? seat.digestivos : [];
  if (!String(item?.name || "").trim()) return current;
  return [...current, digestivoEntry(item)];
};
