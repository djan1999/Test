import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { ErrorBoundary } from './App.jsx';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';

// Register the service worker. With registerType:'autoUpdate' in vite.config.js
// the worker silently updates in the background whenever a new build is deployed.
// When WiFi drops mid-service the app shell and last-known Supabase responses are
// served from cache; when connectivity returns the SW re-fetches automatically.
registerSW({
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
