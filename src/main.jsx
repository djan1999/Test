import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';

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

// Register the service worker. With registerType:'autoUpdate' in vite.config.js
// the worker silently updates in the background whenever a new build is deployed.
// When WiFi drops mid-service the app shell and last-known Supabase responses are
// served from cache; when connectivity returns the SW re-fetches automatically.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply newly available SW immediately so users don't stay on stale assets.
    updateSW(true);
  },
  onRegistered(registration) {
    if (registration) {
      // Poll for updates every 60 s so a freshly deployed build is picked up
      // without requiring a full page reload during a live service.
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
