// One service instance gets one stable archive id on every device. If two
// tablets end the same service, both submit the same primary key instead of
// creating duplicate archive rows with slightly different labels.
//
// The derivation must be identical on EVERY device — the old kitchen display
// most of all. The previous implementation hashed with crypto.subtle and fell
// back to a RANDOM uuid when it was missing (old embedded browsers, plain-http
// contexts) — which silently defeated the cross-device dedup on exactly the
// device class it existed for. Now a pure synchronous FNV-1a over four seeded
// lanes: no crypto dependency, same id everywhere, forever stable for a given
// (workspaceId, startedAt) pair.

import { randomUuid } from "./uuid.js";

const FNV_PRIME = 0x01000193;

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

const hex32 = (n) => n.toString(16).padStart(8, "0");

export async function archiveIdForService(workspaceId, startedAt) {
  if (!workspaceId || !startedAt) return randomUuid(); // no identity to derive from
  const input = `${workspaceId}|${startedAt}`;
  // Four independently-seeded 32-bit lanes → 128 bits of deterministic id.
  const bytes = (
    hex32(fnv1a(input, 0x811c9dc5)) +
    hex32(fnv1a(input, 0x1b873593)) +
    hex32(fnv1a(input, 0x85ebca6b)) +
    hex32(fnv1a(input, 0xc2b2ae35))
  ).split("");
  // RFC 9562 UUIDv8 (custom deterministic payload) + standard variant bits.
  const value = bytes.join("");
  const v = (hexStr, idx, mask, set) => {
    const n = (parseInt(hexStr[idx], 16) & mask) | set;
    return n.toString(16);
  };
  const fixed = value.slice(0, 12) + v(value, 12, 0x0, 0x8) + value.slice(13, 16)
    + v(value, 16, 0x3, 0x8) + value.slice(17);
  return `${fixed.slice(0, 8)}-${fixed.slice(8, 12)}-${fixed.slice(12, 16)}-${fixed.slice(16, 20)}-${fixed.slice(20)}`;
}
