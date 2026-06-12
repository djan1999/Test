import { useSyncExternalStore } from "react";

// Module-level mirror of the current 86 list, following the same pattern as
// the dietary.js restrictions cache: deep components (search dropdowns,
// quick-access buttons) read availability without threading a prop through
// every layer. App.jsx owns loading/saving; this is just the live mirror.

let keySet = new Set();
const listeners = new Set();

export function setEightySixCache(keys) {
  keySet = new Set(Array.isArray(keys) ? keys : []);
  listeners.forEach(l => l());
}

export const getEightySixSet = () => keySet;

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive Set of 86'd item keys (see src/utils/eightySix.js for the scheme). */
export function useEightySix() {
  return useSyncExternalStore(subscribe, getEightySixSet, getEightySixSet);
}
