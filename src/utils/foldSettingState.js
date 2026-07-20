// Three-way merges for the shared service_settings documents that are edited
// by several devices. `ancestor` is the value this device originally saw,
// `mine` is its edited value, and `server` is the newest Postgres value.

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asObject = (value) => isObject(value) ? value : {};
const stableJson = (value) => JSON.stringify(value ?? null);
const equal = (a, b) => stableJson(a) === stableJson(b);

const chooseThreeWay = (ancestor, mine, server) => {
  const mineChanged = !equal(mine, ancestor);
  const serverChanged = !equal(server, ancestor);
  if (!mineChanged) return { value: server, conflict: false };
  if (!serverChanged || equal(mine, server)) return { value: mine, conflict: false };
  return { value: server, conflict: true };
};

// Floor SET markers are independent leaves: [map id][table label]. Because a
// leaf only has two values (SET or absent), concurrent edits either agree or
// affect different leaves. This fold therefore preserves both waiters' taps.
export function foldFloorStatus(ancestor, mine, server) {
  const base = asObject(ancestor);
  const local = asObject(mine);
  const remote = asObject(server);
  const out = {};
  const mapIds = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);

  for (const mapId of mapIds) {
    const a = asObject(base[mapId]);
    const l = asObject(local[mapId]);
    const s = asObject(remote[mapId]);
    const labels = new Set([...Object.keys(a), ...Object.keys(l), ...Object.keys(s)]);
    const merged = {};
    for (const label of labels) {
      const { value } = chooseThreeWay(a[label], l[label], s[label]);
      if (value === "SET") merged[label] = "SET";
    }
    if (Object.keys(merged).length) out[mapId] = merged;
  }
  return { state: out, conflicts: [] };
}

const mapsById = (state) => new Map(
  (Array.isArray(state?.maps) ? state.maps : [])
    .filter((map) => map && typeof map.id === "string" && map.id)
    .map((map) => [map.id, map]),
);

// Small deterministic hash: a retry of the same collision produces the SAME
// recovery id instead of minting another copy on every upload attempt.
const hashText = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const recoveredMap = (map, originalId) => {
  const suffix = hashText(stableJson(map));
  return {
    ...map,
    id: `${originalId}__recovered_${suffix}`,
    name: `${String(map?.name || originalId).replace(/\s+— RECOVERED COPY$/i, "")} — RECOVERED COPY`,
  };
};

const mergeObjectFields = (ancestor, mine, server) => {
  const a = asObject(ancestor);
  const l = asObject(mine);
  const s = asObject(server);
  const out = {};
  let conflict = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(l), ...Object.keys(s)])) {
    const chosen = chooseThreeWay(a[key], l[key], s[key]);
    if (chosen.value !== undefined) out[key] = chosen.value;
    conflict ||= chosen.conflict;
  }
  return { value: out, conflict };
};

// Floor maps are merged per MAP instead of as one restaurant-wide blob. Two
// admins editing different maps keep both changes. If they edit the same map
// concurrently, silently choosing one would still destroy work, so the server
// map stays authoritative and the local design is retained as a clearly named
// RECOVERED COPY for an admin to review/delete later.
export function foldFloorMaps(ancestor, mine, server) {
  const base = asObject(ancestor);
  const local = asObject(mine);
  const remote = asObject(server);
  const aMaps = mapsById(base);
  const lMaps = mapsById(local);
  const sMaps = mapsById(remote);
  const mergedMaps = [];
  const conflicts = [];

  const ids = new Set([...aMaps.keys(), ...lMaps.keys(), ...sMaps.keys()]);
  for (const id of ids) {
    const a = aMaps.get(id);
    const l = lMaps.get(id);
    const s = sMaps.get(id);
    const chosen = chooseThreeWay(a, l, s);
    if (chosen.value) mergedMaps.push(chosen.value);
    if (chosen.conflict && l) {
      const copy = recoveredMap(l, id);
      if (!mergedMaps.some((map) => map.id === copy.id)) mergedMaps.push(copy);
      conflicts.push({ type: "map", mapId: id, recoveredMapId: copy.id });
    }
  }

  // Merge config one option at a time. Geometry version only moves forward.
  const config = mergeObjectFields(base.config, local.config, remote.config);
  if (config.conflict) conflicts.push({ type: "config" });
  const active = chooseThreeWay(base.activeDiningMapId, local.activeDiningMapId, remote.activeDiningMapId);
  if (active.conflict) conflicts.push({ type: "active-map" });

  const geometryVersion = Math.max(
    Number(base.geometryVersion) || 0,
    Number(local.geometryVersion) || 0,
    Number(remote.geometryVersion) || 0,
  );
  const activeDiningMapId = mergedMaps.some((map) => map.id === active.value && map.kind === "dining")
    ? active.value
    : (mergedMaps.find((map) => map.kind === "dining")?.id || mergedMaps[0]?.id || null);

  return {
    state: {
      ...remote,
      geometryVersion,
      maps: mergedMaps,
      activeDiningMapId,
      config: config.value,
    },
    conflicts,
  };
}

export function foldSettingState(id, ancestor, mine, server) {
  if (id === "floor_status_v1") return foldFloorStatus(ancestor, mine, server);
  if (id === "floor_maps_v1") return foldFloorMaps(ancestor, mine, server);
  return { state: mine, conflicts: [] };
}

export const MERGEABLE_SETTING_KEYS = new Set(["floor_status_v1", "floor_maps_v1"]);
