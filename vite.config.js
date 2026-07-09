import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Let main.jsx call registerSW() explicitly so we have full control.
      registerType: 'autoUpdate',
      injectRegister: null,

      includeAssets: ['icon.svg', 'logo.svg'],
      manifest: {
        name: 'Milka Service Board',
        short_name: 'Milka Board',
        description: 'Restaurant service & kitchen management',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        orientation: 'any',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // App shell — precached with cache-first (revision-stamped filenames).
        // wasm is the PowerSync/wa-sqlite SQLite core: without it precached,
        // the offline-first engine itself needed a live network fetch at boot,
        // and a flaky link pinned the device to the direct-Supabase fallback
        // for the whole session (the wifi-extender kitchen-display incident).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // The async wa-sqlite cores are ~2.3–2.6 MB, over workbox's 2 MiB
        // default — without this they'd be silently dropped from the precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/',

        runtimeCaching: [
          // Fonts — rarely change, cache aggressively.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // Supabase REST + Auth APIs — network-first so live updates come
          // through when online; falls back to the last cached response when
          // WiFi drops mid-service so the board stays readable.
          {
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              // Give up waiting for the network after 5 s and serve stale.
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // Sync endpoint — long-running scrape, never cache, no SW timeout.
          {
            urlPattern: /\/api\/sync-wines.*/i,
            handler: 'NetworkOnly',
          },

          // Local serverless API routes (/api/*) — network-first with fallback.
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'local-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // PowerSync (wa-sqlite) ships a WASM SQLite + web worker. Keep them out of
  // Vite's dep pre-bundling and emit workers as ES modules so the on-device DB
  // builds and loads correctly. Inert unless the PowerSync pilot is enabled.
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Stable vendor chunks: app code changes don't invalidate the cached
        // (and PWA-precached) React/Supabase bundles on every deploy.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
