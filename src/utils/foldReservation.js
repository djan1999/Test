import { foldRestrictions } from "./foldTable.js";

const FLOW_KEYS = ["visit_state", "terrace_table", "terrace_map_id", "moved_at"];
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const choose = (ancestor, mine, server) => {
  const mineChanged = !eq(mine, ancestor);
  const serverChanged = !eq(server, ancestor);
  if (!mineChanged) return { value: server, conflict: false };
  if (!serverChanged || eq(mine, server)) return { value: mine, conflict: false };
  return { value: mine, conflict: true };
};

const foldObject = (ancestor, mine, server) => {
  const a = asObject(ancestor);
  const m = asObject(mine);
  const s = asObject(server);
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(m), ...Object.keys(s)])) {
    const chosen = choose(a[key], m[key], s[key]);
    if (chosen.value !== undefined) out[key] = chosen.value;
  }
  return out;
};

const pickFields = (source, keys) => Object.fromEntries(
  keys.filter((key) => source && Object.prototype.hasOwnProperty.call(source, key))
    .map((key) => [key, source[key]]),
);

export function foldReservationData(ancestor, mine, server) {
  const a = asObject(ancestor);
  const m = asObject(mine);
  const s = asObject(server);
  const out = {};
  const conflicts = [];
  const special = new Set(["restrictions", "kitchenCourseNotes", ...FLOW_KEYS]);

  for (const key of new Set([...Object.keys(a), ...Object.keys(m), ...Object.keys(s)])) {
    if (special.has(key)) continue;
    const chosen = choose(a[key], m[key], s[key]);
    if (chosen.value !== undefined) out[key] = chosen.value;
    if (chosen.conflict) conflicts.push({ type: "field", field: key });
  }

  out.restrictions = foldRestrictions(a.restrictions, m.restrictions, s.restrictions);
  out.kitchenCourseNotes = foldObject(
    a.kitchenCourseNotes,
    m.kitchenCourseNotes,
    s.kitchenCourseNotes,
  );

  // Terrace lifecycle fields form one state-machine transition. Merging them
  // separately could create an impossible hybrid such as visit_state=dining
  // with a newly assigned terrace table. If both devices changed the flow,
  // preserve the server transition and report the conflict; independent name,
  // pax, notes and restriction edits still merge around it.
  const flow = choose(
    pickFields(a, FLOW_KEYS),
    pickFields(m, FLOW_KEYS),
    pickFields(s, FLOW_KEYS),
  );
  if (flow.conflict) conflicts.push({ type: "terrace-flow" });
  const chosenFlow = flow.conflict ? pickFields(s, FLOW_KEYS) : flow.value;
  Object.assign(out, chosenFlow || {});

  return { data: out, conflicts };
}

export function foldReservationRow(ancestor, mine, server) {
  if (!ancestor) return { row: mine, conflicts: [] };
  const conflicts = [];
  const date = choose(ancestor.date, mine.date, server.date);
  const tableId = choose(ancestor.table_id, mine.table_id, server.table_id);
  if (date.conflict) conflicts.push({ type: "date" });
  if (tableId.conflict) conflicts.push({ type: "table-assignment" });
  const foldedData = foldReservationData(ancestor.data, mine.data, server.data);

  return {
    row: {
      ...server,
      date: date.conflict ? server.date : date.value,
      table_id: tableId.conflict ? server.table_id : tableId.value,
      data: foldedData.data,
    },
    conflicts: [...conflicts, ...foldedData.conflicts],
  };
}
