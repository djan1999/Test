// GENERATED FILE — DO NOT EDIT.
// Copied verbatim from src/domain/reservations by scripts/syncEdgeDomain.mjs.
// Edit the source and re-run `npm run sync:edge-domain`.

// A restaurant's worth of fictional reservations, for the LAB.
//
// An empty Day Book tells you nothing. To see whether the Timeline reads
// correctly at a glance, whether the Guests tab spots a returning guest,
// whether a combined party prints properly on the allergy sheet, you need a
// book that looks like a real one: months of completed service behind you, a
// full evening in front of you, regulars on their own cadences, the occasional
// no-show, and a party of six on two tables pushed together.
//
// Everything here is fictional and deliberately obvious about it — Slovene and
// German names a real restaurant would recognise as invented, telephone numbers
// in the reserved ranges. Only fictional data may ever be entered in the LAB.
//
// Two properties make this safe to run more than once:
//
//   · DETERMINISTIC — the same seed and the same anchor date always produce the
//     same world, down to the ids, so re-seeding upserts the rows it wrote last
//     time rather than filing a second copy of the summer.
//   · DATE-RELATIVE — the world is built around an anchor day you pass in, so
//     seeding in March gives you March, not a hard-coded 2026.
//
// Pure: it reads no clock of its own and touches no database. The caller says
// what "today" is and what to do with the result.

const FNV_PRIME = 0x01000193;

function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

const hex32 = (value) => value.toString(16).padStart(8, "0");

/** A UUID derived from a string, the same way archiveIdentity.js derives an
 *  archive id: four seeded FNV-1a lanes, formatted as RFC 9562 UUIDv8. Same
 *  input, same id, on every machine and forever — which is what makes a
 *  re-seed an update instead of a duplicate. */
export function deterministicUuid(seedText) {
  const value = (
    hex32(fnv1a(seedText, 0x811c9dc5))
    + hex32(fnv1a(seedText, 0x1b873593))
    + hex32(fnv1a(seedText, 0x85ebca6b))
    + hex32(fnv1a(seedText, 0xc2b2ae35))
  );
  const nibble = (index, mask, set) => ((parseInt(value[index], 16) & mask) | set).toString(16);
  const fixed = value.slice(0, 12) + nibble(12, 0x0, 0x8) + value.slice(13, 16)
    + nibble(16, 0x3, 0x8) + value.slice(17);
  return `${fixed.slice(0, 8)}-${fixed.slice(8, 12)}-${fixed.slice(12, 16)}-${fixed.slice(16, 20)}-${fixed.slice(20)}`;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const minutesOf = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return (hours * 60) + minutes;
};
const shift = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

// Reserved-for-fiction number ranges: Ofcom's +44 7700 900xxx and the German
// 015xx test blocks. Nobody's telephone rings.
const REGULARS = [
  ["Zupan, Marko", "sl", "+386 40 000 101", "", [], 21, "Always asks after the venison. Prefers T02.", ["regular"]],
  ["Kovač, Petra", "sl", "+386 40 000 102", "petra.kovac@example.com", ["gluten"], 24, "", ["regular"]],
  ["Oblak, Tina", "sl", "+386 40 000 103", "tina.oblak@example.com", [], 35, "Anniversary every summer — cake arranged each year.", ["vip"]],
  ["Novak, Jure", "sl", "+386 40 000 104", "", [], 28, "Aperitif on the terrace first, likes to linger.", ["regular"]],
  ["Müller, Katrin", "en", "+49 1511 000105", "k.mueller@example.com", ["dairy"], 42, "Stays in the hotel each visit — quiet table.", ["hotel-regular"]],
  ["Hartmann, Rolf", "en", "+49 1511 000106", "", [], 49, "", ["hotel-regular"]],
  ["Vidmar, Ana", "sl", "+386 40 000 107", "ana.vidmar@example.com", ["veg"], 18, "", ["regular"]],
  ["Kranjc, Boštjan", "sl", "+386 40 000 108", "", [], 30, "Business dinners — short menu, brisk service.", []],
  ["Whitmore, Sarah", "en", "+44 7700 900109", "sarah.whitmore@example.com", [], 60, "Window seat preference.", []],
  ["Golob, Maja", "sl", "+386 40 000 110", "maja.golob@example.com", ["nut"], 27, "Severe nut allergy — kitchen briefed every visit.", ["allergy-alert"]],
  ["Lindqvist, Erik", "en", "+46 70 000 0111", "erik.lindqvist@example.com", ["nut"], 55, "", []],
  ["Hribar, Tomaž", "sl", "+386 40 000 112", "", [], 33, "", ["regular"]],
];

const OCCASIONALS = [
  ["Petek, Luka", "sl", "+386 40 000 201", "", []],
  ["Koren, Nina", "sl", "+386 40 000 202", "nina.koren@example.com", ["vegan"]],
  ["Lah, Mojca", "sl", "+386 40 000 203", "", ["gluten"]],
  ["Fischer, Anke", "en", "+49 1511 000204", "anke.fischer@example.com", []],
  ["Baker, James", "en", "+44 7700 900205", "jbaker@example.com", ["shellfish"]],
  ["Dubois, Claire", "en", "+33 6 00 00 0206", "claire.dubois@example.com", ["dairy"]],
  ["O'Brien, Ciara", "en", "+353 87 000 0207", "ciara.obrien@example.com", ["veg"]],
  ["Moretti, Luca", "en", "+39 340 000 0208", "luca.moretti@example.com", []],
  ["García, Elena", "en", "+34 600 000 209", "", ["no_pork"]],
  ["Horvat, Živa", "sl", "+386 40 000 210", "ziva.horvat@example.com", []],
];

const FIRST = ["Jan", "Vesna", "Rok", "Tjaša", "Miha", "Urška", "Blaž", "Neža", "Aleš", "Polona", "Hana", "Eva", "Thomas", "Marie", "Stefan", "Julia"];
const LAST = ["Kos", "Bizjak", "Kotnik", "Mlakar", "Pirc", "Jerman", "Dolenc", "Weber", "Keller", "Bauer", "Meier", "Wagner", "Berg", "Lund"];
const NOTES = [
  "Window seat if possible", "Wine pairing", "Celebrating a promotion",
  "First visit to Slovenia", "Quiet corner requested",
  "Walking the pass tomorrow — an early finish would be welcome", "",
];
const OCCASIONS = ["", "", "", "Birthday", "Anniversary", "Celebration"];

/** Intervals a table is held for, mirroring the engine's own durations. */
const durationFor = (pax, durations) => {
  if (pax <= 2) return durations.small;
  if (pax <= 5) return durations.medium;
  return durations.large;
};

/**
 * Build the world.
 *
 * @param {object}  options
 * @param {string}  options.today       anchor date, ISO. The world runs around it.
 * @param {object}  options.config      normalized reservation config (tables, combos, pacing, durations)
 * @param {Array}   options.services    normalized weekly services — the seatings actually served
 * @param {number} [options.pastDays]   days of completed service behind the anchor
 * @param {number} [options.futureDays] days of forward bookings
 * @param {number} [options.seed]       change it for a different, equally repeatable world
 * @returns {{ bookings: Array, waitlist: Array, summary: object }}
 */
export function buildLabWorld({
  today,
  config,
  services,
  pastDays = 90,
  futureDays = 28,
  seed = 20260721,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) {
    throw new Error("buildLabWorld needs an anchor date.");
  }
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (probability) => random() < probability;

  const tables = config.tables || [];
  const combos = config.combos || [];
  const durations = config.durations || { small: 120, medium: 150, large: 180, buffer: 15 };
  const buffer = Number(durations.buffer || 15);
  const perSlot = Number(config.pacing?.coversPerSlot || 12);
  const seatsOf = (label) => Number((tables.find((table) => table.id === label) || {}).seats || 0);

  const pool = [
    ...REGULARS.map(([name, language, phone, email, allergies, cadence, note, tags]) => ({
      name, language, phone, email, allergies, cadence, note, tags, returning: true,
    })),
    ...OCCASIONALS.map(([name, language, phone, email, allergies]) => ({
      name, language, phone, email, allergies, cadence: 9999, note: "", tags: [], returning: false,
    })),
  ];
  const lastVisit = new Map();

  const newcomer = () => {
    const name = `${pick(LAST)}, ${pick(FIRST)}`;
    return {
      name,
      language: chance(0.55) ? "sl" : "en",
      phone: `+386 40 000 ${String(300 + Math.floor(random() * 600))}`,
      email: chance(0.5) ? `${name.split(",")[0].toLowerCase().replace(/[^a-z]/g, "")}@example.com` : "",
      allergies: chance(0.2) ? [pick(["gluten", "dairy", "nut", "veg", "vegan", "shellfish"])] : [],
      cadence: 9999,
      note: "",
      tags: [],
      returning: false,
    };
  };

  const guestFor = (date) => {
    const due = pool.filter((guest) => guest.returning && (
      !lastVisit.has(guest.name)
      || (new Date(date) - new Date(lastVisit.get(guest.name))) / 86400000 >= guest.cadence * (0.7 + (random() * 0.6))
    ));
    if (due.length && chance(0.5)) return pick(due);
    if (chance(0.4)) return pick(pool.filter((guest) => !guest.returning));
    return newcomer();
  };

  // date|table → [{start, end}]. The generator books the room honestly, so the
  // world it produces never contains a double booking the engine would refuse.
  const held = new Map();
  const free = (date, label, start, end) => !(held.get(`${date}|${label}`) || [])
    .some((span) => start < span.end + buffer && span.start < end + buffer);
  const hold = (date, label, start, end) => {
    const key = `${date}|${label}`;
    if (!held.has(key)) held.set(key, []);
    held.get(key).push({ start, end });
  };
  const coversAt = new Map();

  const place = (date, time, pax) => {
    const slotKey = `${date}|${time}`;
    if ((coversAt.get(slotKey) || 0) + pax > perSlot) return null;
    const start = minutesOf(time);
    const end = start + durationFor(pax, durations);
    const single = tables
      .filter((table) => Number(table.seats) >= pax && free(date, table.id, start, end))
      .sort((a, b) => (a.seats - pax) - (b.seats - pax) || String(a.id).localeCompare(String(b.id)))[0];
    if (single) return [String(single.id)];
    const pair = combos
      .map((combo) => combo.map(String))
      .find((combo) => (
        combo.reduce((total, label) => total + seatsOf(label), 0) >= pax
        && combo.every((label) => free(date, label, start, end))
      ));
    return pair || null;
  };

  const bookings = [];
  const from = shift(today, -Math.abs(pastDays));
  const to = shift(today, Math.abs(futureDays));

  for (let date = from; date <= to; date = shift(date, 1)) {
    const day = weekday(date);
    const served = (services || []).filter((service) => Number(service.weekday) === day && service.enabled !== false);
    served.forEach((service) => {
      const slots = [];
      for (let at = minutesOf(service.first); at <= minutesOf(service.last); at += Number(service.interval || 30)) {
        slots.push(`${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
      }
      if (!slots.length) return;
      // Fuller at the weekend, quieter at lunch — a flat book reads as fake.
      const busy = (day === 5 || day === 6) ? 1 : 0;
      const parties = service.service === "lunch"
        ? 1 + Math.floor(random() * 3)
        : 3 + Math.floor(random() * 3) + busy;

      for (let index = 0; index < parties; index += 1) {
        const guest = guestFor(date);
        // A handful of parties are bigger than any single table, so the world
        // actually exercises combined seating — the case the edge engine had
        // silently got wrong. Staff take these by telephone; they are larger
        // than online.maxPax on purpose.
        const pax = chance(0.06)
          ? 7 + Math.floor(random() * 4)
          : (chance(0.5) ? 2 : (chance(0.6) ? 3 + Math.floor(random() * 2) : 5 + Math.floor(random() * 2)));
        const time = pick(slots);
        const seated = place(date, time, pax);
        if (!seated) continue;

        const start = minutesOf(time);
        seated.forEach((label) => hold(date, label, start, start + durationFor(pax, durations)));
        coversAt.set(`${date}|${time}`, (coversAt.get(`${date}|${time}`) || 0) + pax);
        lastVisit.set(guest.name, date);

        const source = pax > Number(config.online?.maxPax || 6)
          ? "phone"
          : (chance(0.4) ? "phone" : (chance(0.7) ? "web" : (chance(0.5) ? "walk_in" : "waitlist")));
        let status;
        if (date < today) {
          const roll = random();
          if (roll < 0.05) status = "cancelled";
          else if (roll < 0.08) status = "no_show";
          else status = "completed";
        } else if (date === today) {
          status = chance(0.85) ? "confirmed" : "pending";
        } else {
          status = (pax > 4 && source === "web") || chance(0.12) ? "pending" : "confirmed";
        }

        // The id and the key are derived from what identifies the party, so a
        // second seeding writes the same rows rather than a second summer.
        const identity = `lab:${seed}:${date}:${service.service}:${time}:${guest.name}:${index}`;
        bookings.push({
          id: deterministicUuid(identity),
          idempotencyKey: identity,
          date,
          service: service.service,
          time,
          pax,
          status,
          name: guest.name,
          phone: guest.phone,
          email: guest.email || "",
          language: guest.language,
          source,
          tableLabel: seated[0],
          experience: chance(0.7) ? "grand_tasting" : "seasonal",
          occasion: pick(OCCASIONS),
          notes: chance(0.18) ? pick(NOTES) : "",
          allergies: (guest.allergies || []).map((key) => ({ pos: null, note: key })),
          accessibility: chance(0.05) ? ["Step-free access"] : [],
          consentNews: chance(0.3),
          createdBy: source === "web" ? "WEB" : "LAB SEED",
          operationalData: {
            tableGroup: seated,
            menuType: chance(0.7) ? "long" : "short",
            guestType: guest.tags.includes("hotel-regular") ? "hotel" : "outside",
            restrictions: (guest.allergies || []).map((key) => ({ pos: null, note: key })),
            labSeed: true,
          },
        });
      }
    });
  }

  const waiting = [today, shift(today, 1)];
  const waitlist = waiting.map((date, index) => ({
    id: deterministicUuid(`lab:${seed}:waitlist:${date}:${index}`),
    date,
    service: "dinner",
    time: index === 0 ? "19:30" : "",
    window: index === 0 ? "" : "19:00–20:00",
    name: index === 0 ? "Perko, Ana" : "Jensen, Lars",
    phone: index === 0 ? "+386 40 000 211" : "+45 20 000 212",
    email: "",
    pax: index === 0 ? 2 : 4,
    quotedMinutes: index === 0 ? 25 : 30,
    notes: index === 0 ? "Happy to eat at the bar." : "",
    status: "waiting",
  }));

  const counts = bookings.reduce((totals, booking) => ({
    ...totals,
    [booking.status]: (totals[booking.status] || 0) + 1,
  }), {});

  return {
    bookings,
    waitlist,
    summary: {
      from,
      to,
      today,
      bookings: bookings.length,
      waitlist: waitlist.length,
      guests: new Set(bookings.map((booking) => booking.name)).size,
      byStatus: counts,
      combined: bookings.filter((booking) => booking.operationalData.tableGroup.length > 1).length,
    },
  };
}
