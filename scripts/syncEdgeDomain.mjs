// Copy the reservation domain rules into the Supabase functions tree.
//
// The Supabase CLI bundles an edge function from its own directory, so it
// cannot reach ../../src. Rather than let the edge function keep a second,
// hand-written copy of the availability rules — which is exactly how it came to
// show the second table of a joined party as free — the domain modules are
// copied here verbatim and the function imports them.
//
//   node scripts/syncEdgeDomain.mjs          write the copies
//   node scripts/syncEdgeDomain.mjs --check  fail if they have drifted
//
// `src/__tests__/edgeDomainSync.test.js` runs the check, so drift fails the
// suite rather than silently reaching production.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCE_DIR = join(root, "src/domain/reservations");
export const TARGET_DIR = join(root, "supabase/functions/_shared/reservations");
export const SYNCED_FILES = ["config.js", "availability.js", "lifecycle.js"];

export const BANNER = [
  "// GENERATED FILE — DO NOT EDIT.",
  "// Copied verbatim from src/domain/reservations by scripts/syncEdgeDomain.mjs.",
  "// Edit the source and re-run `npm run sync:edge-domain`.",
  "",
  "",
].join("\n");

export function expectedContent(file) {
  return BANNER + readFileSync(join(SOURCE_DIR, file), "utf8");
}

export function currentContent(file) {
  try {
    return readFileSync(join(TARGET_DIR, file), "utf8");
  } catch {
    return null;
  }
}

export function drifted() {
  return SYNCED_FILES.filter((file) => currentContent(file) !== expectedContent(file));
}

function main() {
  const check = process.argv.includes("--check");
  const stale = drifted();
  if (check) {
    if (stale.length) {
      console.error(`Edge copies are stale: ${stale.join(", ")}. Run \`npm run sync:edge-domain\`.`);
      process.exit(1);
    }
    console.log("Edge domain copies are in sync.");
    return;
  }
  mkdirSync(TARGET_DIR, { recursive: true });
  SYNCED_FILES.forEach((file) => writeFileSync(join(TARGET_DIR, file), expectedContent(file)));
  console.log(`Synced ${SYNCED_FILES.length} files into supabase/functions/_shared/reservations.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
