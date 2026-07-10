const hex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

// One service instance gets one stable archive id on every device. If two
// tablets end the same service, both submit the same primary key instead of
// creating duplicate archive rows with slightly different labels.
export async function archiveIdForService(workspaceId, startedAt) {
  if (!workspaceId || !startedAt || !globalThis.crypto?.subtle) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    random[6] = (random[6] & 0x0f) | 0x40;
    random[8] = (random[8] & 0x3f) | 0x80;
    const value = hex(random);
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${workspaceId}|${startedAt}`),
  )).slice(0, 16);
  // RFC 9562 UUIDv8: custom deterministic payload + standard variant bits.
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const value = hex(digest);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
