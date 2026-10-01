// Stale chunk/preload errors after a deploy (common with installed PWAs).
// Vite rejects the dynamic import unless the handler calls preventDefault();
// with preventDefault() the import RESOLVES TO undefined instead. Calling it
// turned every failed chunk load into
// "Cannot destructure property 'startWatches' of undefined" (the PowerSync
// start) or a React.lazy crash, recorded before the reload even landed. So
// never suppress: the caller sees the real load error (and its own retry runs),
// while the page reloads once onto the new build.
export const PRELOAD_RELOAD_GUARD_KEY = 'milka_preload_reload_once';

export function handlePreloadError(_event, { storage, reload }) {
  try {
    if (storage.getItem(PRELOAD_RELOAD_GUARD_KEY) !== '1') {
      storage.setItem(PRELOAD_RELOAD_GUARD_KEY, '1');
      reload();
      return true;
    }
    storage.removeItem(PRELOAD_RELOAD_GUARD_KEY);
  } catch {}
  return false;
}
