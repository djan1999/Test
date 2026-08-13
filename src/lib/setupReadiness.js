/**
 * Setup readiness — "can this restaurant open tonight?", answered from the
 * workspace's own data.
 *
 * Gate C's test is a restaurant nobody on the project has ever met: it gets an
 * account and has to reach a first service without anyone touching the
 * database. Every configuration surface for that already exists (Restaurant
 * Setup, Floor, Menu Layout, Staff, ...), but nothing ever told a new admin
 * what order to do them in, or when they were finished. This module is that
 * missing answer.
 *
 * Two rules keep it honest:
 *
 *  1. Nothing here is stored. A step is `done` because the data says so, not
 *     because somebody ticked a box. A checklist with its own persisted state
 *     drifts away from the restaurant and then lies to it.
 *  2. `blocked` means the first service genuinely breaks — a reservation with
 *     nowhere to sit, a kitchen with no courses to fire. Everything a
 *     restaurant can reasonably open without is `attention`, never a blocker.
 *     If the difference blurs, admins learn to ignore the whole screen.
 *
 * Browser-free and dependency-light so the rules stay unit-testable.
 */

import { getActiveDiningMap, resolveReservationTable } from "../utils/floorMaps.js";

export const STATUS = Object.freeze({
  DONE: "done",
  ATTENTION: "attention",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
});

// Names the scaffold hands out. A workspace still carrying them has been
// created but not yet configured, which is exactly what we want to say.
const PLACEHOLDER_NAMES = new Set(["", "restaurant", "service board", "new restaurant"]);
const SCAFFOLD_COURSE_NAME = /^(?:course|hod)\s*\d+$/i;
const DEFAULT_TABLE_LABEL = /^T\d{2}$/;

const text = (value) => String(value ?? "").trim();
const activeCourses = (courses) =>
  (Array.isArray(courses) ? courses : []).filter((course) => course?.is_active !== false);

function step(id, title, section, status, summary, action = "") {
  return { id, title, section, status, summary, action };
}

// ── the eight steps, in the order a restaurant actually does them ───────────

function identityStep(config) {
  const name = text(config?.name);
  if (!name || PLACEHOLDER_NAMES.has(name.toLowerCase())) {
    return step(
      "identity", "Name the restaurant", "restaurant", STATUS.BLOCKED,
      "This workspace still carries its placeholder name. It prints on the menu, the board header and the kitchen display.",
      "Open Restaurant Setup and enter the restaurant's real name.",
    );
  }
  return step(
    "identity", "Name the restaurant", "restaurant", STATUS.DONE,
    `Operating as “${name}”.`,
  );
}

function tablesStep(config) {
  const tables = Array.isArray(config?.tables) ? config.tables : [];
  if (!tables.length) {
    return step(
      "tables", "Create the tables", "restaurant", STATUS.BLOCKED,
      "No tables are configured, so there is nothing to seat a party on.",
      "Open Restaurant Setup and add one row per table in the room.",
    );
  }
  // The scaffold is ten tables labelled T01…T10. Untouched, that is a strong
  // signal nobody has compared it against the real room yet — but it is a
  // legitimate configuration for a ten-table restaurant, so it never blocks.
  const untouched = tables.length === 10
    && tables.every((table) => DEFAULT_TABLE_LABEL.test(text(table?.label)));
  if (untouched) {
    return step(
      "tables", "Create the tables", "restaurant", STATUS.ATTENTION,
      "Still the starter scaffold: ten tables labelled T01–T10.",
      "Confirm the real table count and the numbers the staff actually say out loud.",
    );
  }
  return step(
    "tables", "Create the tables", "restaurant", STATUS.DONE,
    `${tables.length} table${tables.length === 1 ? "" : "s"} configured (${tables.slice(0, 4).map((table) => text(table.label)).join(", ")}${tables.length > 4 ? ", …" : ""}).`,
  );
}

function floorStep(config, floorMaps) {
  const tables = Array.isArray(config?.tables) ? config.tables : [];
  if (!floorMaps) {
    return step("floor", "Lay out the floor", "floor", STATUS.UNKNOWN, "The floor layouts have not loaded on this device yet.");
  }
  const map = getActiveDiningMap(floorMaps);
  if (!map) {
    return step(
      "floor", "Lay out the floor", "floor", STATUS.BLOCKED,
      "No dining layout is active, so the floor view has no room to draw.",
      "Open Floor & Terrace and activate a dining layout.",
    );
  }
  // The failure this catches is specific and ugly: a configured table with no
  // place on the active map renders dead mid-service — no seats, no status, no
  // SET. Better to say it now than at 20:00.
  const homeless = tables
    .filter((table) => !resolveReservationTable(map, table?.id).table)
    .map((table) => text(table.label) || `T${table?.id}`);
  if (homeless.length) {
    return step(
      "floor", "Lay out the floor", "floor", STATUS.BLOCKED,
      `${homeless.length} configured table${homeless.length === 1 ? " has" : "s have"} no place on the active layout “${text(map.name) || map.id}”: ${homeless.slice(0, 6).join(", ")}${homeless.length > 6 ? ", …" : ""}. A party seated there would have no seats and no kitchen status.`,
      "Open Floor & Terrace and add each missing table to the active layout, or remove it in Restaurant Setup.",
    );
  }
  return step(
    "floor", "Lay out the floor", "floor", STATUS.DONE,
    `Layout “${text(map.name) || map.id}” is active and covers every configured table.`,
  );
}

function coursesStep(courses) {
  const active = activeCourses(courses);
  if (!active.length) {
    return step(
      "courses", "Configure the courses", "menu", STATUS.BLOCKED,
      "No active courses exist, so the kitchen display has nothing to fire and the board has nothing to progress.",
      "Open Menu Layout and add the courses this restaurant serves.",
    );
  }
  const keyless = active.filter((course) => !text(course?.course_key));
  if (keyless.length) {
    return step(
      "courses", "Configure the courses", "menu", STATUS.ATTENTION,
      `${keyless.length} active course${keyless.length === 1 ? " has" : "s have"} no course key. Kitchen notes, pairings and restriction variants attach to that key.`,
      "Open Menu Layout and give every course a key.",
    );
  }
  return step("courses", "Configure the courses", "menu", STATUS.DONE, `${active.length} active course${active.length === 1 ? "" : "s"} in the running order.`);
}

function menuStep(courses) {
  const active = activeCourses(courses);
  if (!active.length) {
    return step("menu", "Add the menu", "menu", STATUS.BLOCKED, "There are no courses to write dishes into yet.", "Configure the courses first.");
  }
  const scaffold = active.filter((course) => {
    const name = text(course?.menu?.name);
    return !name || SCAFFOLD_COURSE_NAME.test(name);
  });
  if (scaffold.length === active.length) {
    return step(
      "menu", "Add the menu", "menu", STATUS.BLOCKED,
      "Every course still shows its scaffold name. Guests would receive a menu reading “Course 1, Course 2 …”.",
      "Open Menu Layout and write each course's real dish name.",
    );
  }
  if (scaffold.length) {
    return step(
      "menu", "Add the menu", "menu", STATUS.ATTENTION,
      `${scaffold.length} of ${active.length} active courses still show a scaffold or empty name.`,
      "Open Menu Layout and finish the remaining dish names.",
    );
  }
  return step("menu", "Add the menu", "menu", STATUS.DONE, `All ${active.length} active courses carry a dish name.`);
}

function staffStep(members) {
  if (!Array.isArray(members)) {
    return step("staff", "Create the staff accounts", "staff", STATUS.UNKNOWN, "The staff list has not loaded yet.");
  }
  const admins = members.filter((member) => member?.role === "admin");
  if (!admins.length) {
    return step(
      "staff", "Create the staff accounts", "staff", STATUS.BLOCKED,
      "This restaurant has no Admin account, so nobody here can manage its own setup or staff.",
      "Escalate to the platform operator — a workspace must always keep one Admin.",
    );
  }
  if (members.length === 1) {
    return step(
      "staff", "Create the staff accounts", "staff", STATUS.ATTENTION,
      "One account exists. Every device would be signed in as the same Admin login, so the audit trail cannot tell staff apart.",
      "Open Staff & Roles and invite the people who work the floor and the kitchen.",
    );
  }
  return step("staff", "Create the staff accounts", "staff", STATUS.DONE, `${members.length} accounts, including ${admins.length} Admin${admins.length === 1 ? "" : "s"}.`);
}

function permissionsStep(members) {
  if (!Array.isArray(members)) {
    return step("permissions", "Assign the permissions", "staff", STATUS.UNKNOWN, "The staff list has not loaded yet.");
  }
  const missing = ["service", "kitchen"].filter(
    (role) => !members.some((member) => member?.role === role),
  );
  if (missing.length) {
    // Not a blocker: an Admin login can open every screen, so the restaurant
    // *can* trade. It is an attention because doing so puts an account that
    // can delete the archive on the pass, and flattens the audit trail.
    return step(
      "permissions", "Assign the permissions", "staff", STATUS.ATTENTION,
      `No account holds the ${missing.map((role) => (role === "service" ? "Service" : "Kitchen")).join(" or ")} role. Those devices would have to run on an Admin login, which can also change setup and purge history.`,
      "Open Staff & Roles and give the floor and kitchen accounts their own roles.",
    );
  }
  return step("permissions", "Assign the permissions", "staff", STATUS.DONE, "Service and Kitchen roles are both assigned to real accounts.");
}

function serviceStep(config, restrictions) {
  const features = config?.features || {};
  if (features.hotelGuests === true && !(Array.isArray(features.roomOptions) && features.roomOptions.length)) {
    return step(
      "service", "Configure the service", "restaurant", STATUS.BLOCKED,
      "Hotel guests are switched on but no rooms are listed, so the room picker on every reservation would be empty.",
      "Open Restaurant Setup and list the room numbers, or switch hotel guests off.",
    );
  }
  const list = Array.isArray(restrictions) ? restrictions : [];
  if (!list.length) {
    return step(
      "service", "Configure the service", "dishes", STATUS.ATTENTION,
      "No dietary restrictions are configured, so allergies cannot be recorded against a seat.",
      "Open Dishes & Restrictions and confirm the restriction list this kitchen works to.",
    );
  }
  return step(
    "service", "Configure the service", "restaurant", STATUS.DONE,
    `${list.length} dietary restriction${list.length === 1 ? "" : "s"} available${features.hotelGuests ? `, hotel rooms listed (${features.roomOptions.length})` : ", hotel guests off"}.`,
  );
}

/**
 * Evaluate the whole setup. Every argument is optional; anything missing
 * degrades to `unknown` rather than pretending a step is finished.
 */
export function evaluateSetup({
  restaurantConfig = null,
  floorMaps = null,
  menuCourses = null,
  members = null,
  restrictionsList = null,
} = {}) {
  const steps = [
    identityStep(restaurantConfig),
    tablesStep(restaurantConfig),
    floorStep(restaurantConfig, floorMaps),
    coursesStep(menuCourses),
    staffStep(members),
    permissionsStep(members),
    menuStep(menuCourses),
    serviceStep(restaurantConfig, restrictionsList),
  ].map((entry, index) => ({ ...entry, order: index + 1 }));

  const counts = steps.reduce(
    (totals, entry) => ({ ...totals, [entry.status]: (totals[entry.status] || 0) + 1 }),
    {},
  );
  const blocked = steps.filter((entry) => entry.status === STATUS.BLOCKED);

  return {
    steps,
    counts,
    blocking: blocked,
    // "Ready" is the absence of blockers, not the absence of advice. A
    // restaurant that opens with the starter table labels is unwise, not
    // broken, and the checklist must not pretend otherwise.
    ready: blocked.length === 0,
    headline: blocked.length === 0
      ? "Ready to run a service."
      : `${blocked.length} step${blocked.length === 1 ? "" : "s"} must be finished before the first service.`,
  };
}
