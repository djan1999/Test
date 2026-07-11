// MUST stay the first import: shims AbortSignal.timeout/any for the older
// tablet/display browsers before any library module evaluates (10.07 board
// saves crashed on the kitchen display without it).
import './lib/abortSignalPolyfill.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { setUpdateReady } from './lib/swUpdate.js';

const PRELOAD_RELOAD_GUARD_KEY = 'milka_preload_reload_once';

// Recover from stale chunk/preload errors after deploys (common with installed PWAs).
window.addEventListener('vite:preloadError', (event) => {
  event?.preventDefault?.();
  try {
    const alreadyReloaded = sessionStorage.getItem(PRELOAD_RELOAD_GUARD_KEY) === '1';
    if (!alreadyReloaded) {
      sessionStorage.setItem(PRELOAD_RELOAD_GUARD_KEY, '1');
      window.location.reload();
      return;
    }
    sessionStorage.removeItem(PRELOAD_RELOAD_GUARD_KEY);
  } catch {}
});

// Register the service worker (registerType:'prompt' in vite.config.js). A
// new build downloads in the background and WAITS — applying it immediately
// (the old updateSW(true) here) reloaded every device the moment a deploy
// landed, mid-service included. The waiting build activates when the app is
// next fully closed and reopened, or on demand from the admin SYSTEM panel
// (the kitchen display never closes by itself). While it waits, the running
// service worker keeps serving the CURRENT build's precache, so lazy chunks
// stay loadable and offline behavior is unchanged.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    setUpdateReady(() => updateSW(true));
  },
  onRegistered(registration) {
    if (registration) {
      // Poll every 60 s so a fresh deploy starts downloading in the
      // background right away (it still only ACTIVATES per the rule above).
      setInterval(() => registration.update(), 60_000);
    }
  },
  onRegisterError(error) {
    console.warn('Service worker registration failed:', error);
  },
});

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root was not found. Check index.html.');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
