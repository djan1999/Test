export const DEFAULT_DIETARY_KEYS = [
  "veg",
  "vegan",
  "pescetarian",
  "gluten_free",
  "dairy_free",
  "nut_free",
  "shellfish_free",
  "no_red_meat",
  "no_pork",
  "no_game",
  "no_offal",
  "egg_free",
  "no_alcohol",
  "no_garlic_onion",
  "halal",
  "low_fodmap",
];

export const DEFAULT_RESTRICTIONS = [
  { key: "veg", label: "Vegetarian", emoji: "🥦", group: "dietary" },
  { key: "vegan", label: "Vegan", emoji: "🌱", group: "dietary" },
  { key: "pescetarian", label: "Pescetarian", emoji: "🐟", group: "dietary" },
  { key: "no_red_meat", label: "No Red Meat", emoji: "🚫🥩", group: "dietary" },
  { key: "no_pork", label: "No Pork", emoji: "🚫🐷", group: "dietary" },
  { key: "no_game", label: "No Game", emoji: "🚫🦌", group: "dietary" },
  { key: "no_offal", label: "No Offal", emoji: "🚫🫀", group: "dietary" },
  { key: "gluten", label: "Gluten Free", emoji: "🌾", group: "allergy" },
  { key: "dairy", label: "Dairy Free", emoji: "🥛", group: "allergy" },
  { key: "nut", label: "Nut Free", emoji: "🥜", group: "allergy" },
  { key: "shellfish", label: "Shellfish Free", emoji: "🦐", group: "allergy" },
  { key: "egg_free", label: "Egg Free", emoji: "🥚", group: "allergy" },
  { key: "no_garlic_onion", label: "No Garlic/Onion", emoji: "🧅", group: "allergy" },
  { key: "no_alcohol", label: "No Alcohol", emoji: "🚱", group: "other" },
  { key: "halal", label: "Halal", emoji: "☪️", group: "other" },
  { key: "low_fodmap", label: "Low FODMAP", emoji: "📋", group: "other" },
];

export const RESTRICTION_GROUPS = {
  dietary: "Dietary",
  allergy: "Allergies & Intolerances",
  other: "Lifestyle & Religious",
};

// Live arrays kept in-place — App.jsx calls setRestrictionsCache() once on
// boot after loading from service_settings, splicing the new contents into
// the same exported references. Importers that already hold the array keep
// seeing the current list without re-importing.
export const RESTRICTIONS = [...DEFAULT_RESTRICTIONS];
export const DIETARY_KEYS = [...DEFAULT_DIETARY_KEYS];

export function setRestrictionsCache(list) {
  const next = Array.isArray(list) && list.length > 0 ? list : DEFAULT_RESTRICTIONS;
  RESTRICTIONS.splice(0, RESTRICTIONS.length, ...next);
  DIETARY_KEYS.splice(0, DIETARY_KEYS.length, ...next.map(r => r.key).filter(Boolean));
}

export const restrLabel = (key) => {
  const d = RESTRICTIONS.find((r) => r.key === key);
  return d ? `${d.emoji} ${d.label}` : key;
};

export const restrCompact = (key) => {
  const d = RESTRICTIONS.find((r) => r.key === key);
  return d ? d.label : key;
};
