import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// Build-time rewrites of modern-API calls INSIDE dependency code — the only
// fix that reaches @powersync/wa-sqlite's WEB WORKERS on the old kitchen
// display (page polyfills never do; that's why the 10.07 f864e1a build still
// failed there). AbortSignal.timeout, crypto.randomUUID, toSorted/findLast,
// structuredClone — see vite/compat-plugins.js (unit-tested).
import { compatPlugins } from './vite/compat-plugins.js';

export default defineConfig({
  // Visible build identity (admin SYSTEM panel): ends the "which version is
  // this tablet actually running" guessing that stalled the 10.07 rollout —
  // installed PWAs can serve a stale cached bundle long after a deploy.
  define: {
    __BUILD_ID__: JSON.stringify(
      `${(process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`,
    ),
    // Vercel system variables are not exposed to browser code by Vite. Bake
    // only non-secret deployment context into the bundle so every preview
    // defaults to the fail-closed staging boundary before env setup.
    __DEPLOYMENT_CONTEXT__: JSON.stringify({
      VITE_DEPLOYMENT_ENV: process.env.VITE_DEPLOYMENT_ENV
        || (process.env.VERCEL_ENV === "preview" ? "staging" : "production"),
      VITE_GIT_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || "local",
    }),
  },
  plugins: [
    ...compatPlugins(),
    react(),
    VitePWA({
      // Let main.jsx call registerSW() explicitly so we have full control.
      // 'prompt': a deployed build downloads in the background and WAITS —
      // 'autoUpdate' baked skipWaiting/clientsClaim into the worker, which
      // (with main.jsx's old updateSW(true)) force-reloaded live devices the
      // moment a deploy landed, mid-service included. Activation now happens
      // on next full app reopen or via the SYSTEM panel's APPLY UPDATE
      // (see lib/swUpdate.js).
      registerType: 'prompt',
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

          // Sync endpoint — long-running scrape, never cache, no SW timeout.
          {
            urlPattern: /\/api\/sync-wines.*/i,
            handler: 'NetworkOnly',
          },

          // Server APIs can contain account-specific, changing data. The app
          // shell is offline-capable, but API responses must never be replayed
          // from a service-worker cache as if they were live.
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
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
    // Worker bundles get their own plugin pipeline — the compat rewrites must
    // run there too (that's where @powersync/web's failing calls live).
    plugins: () => [...compatPlugins()],
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
    // Explicit conservative syntax floor — the kitchen display's embedded
    // browser is frozen pre-Chrome-103 (exact age unknown; APIs as old as
    // Chrome 92 have been missing). This matches Vite 6's 'modules' default
    // TODAY but pins it: a future Vite major quietly raising its default
    // (Vite 7 emits ~Chrome-107-level syntax) must not brick the display.
    // Applies to worker bundles too. Runtime APIs are NOT transpiled by this
    // — those are handled by the polyfills/guards (abortSignalPolyfill,
    // utils/uuid, the AbortSignal build rewrite above).
    target: ['es2020', 'chrome87', 'safari14', 'firefox78'],
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
