import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Rewrite dependency calls to AbortSignal.timeout(ms) into a self-contained
// compatible expression. The kitchen display's embedded browser (pre-Chrome
// 103) lacks the API and @powersync/web calls it on the WRITE path — INSIDE
// ITS WEB WORKERS, where a main-thread polyfill (src/lib/abortSignalPolyfill)
// can never reach (workers have their own global scope; that's why the 10.07
// f864e1a build still failed on the display). A build-time rewrite fixes the
// call in every context: main bundle, workers, shared workers.
const abortSignalTimeoutCompat = () => ({
  name: 'abort-signal-timeout-compat',
  transform(code, id) {
    if (!id.includes('node_modules') || !code.includes('AbortSignal.timeout(')) return null;
    return {
      code: code.replaceAll(
        'AbortSignal.timeout(',
        '((typeof AbortSignal!=="undefined"&&AbortSignal.timeout)?AbortSignal.timeout.bind(AbortSignal):function(ms){var c=new AbortController();setTimeout(function(){try{c.abort(new DOMException("The operation timed out.","TimeoutError"))}catch(e){c.abort()}},ms);return c.signal})(',
      ),
      map: null,
    };
  },
});

export default defineConfig({
  // Visible build identity (admin SYSTEM panel): ends the "which version is
  // this tablet actually running" guessing that stalled the 10.07 rollout —
  // installed PWAs can serve a stale cached bundle long after a deploy.
  define: {
    __BUILD_ID__: JSON.stringify(
      `${(process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`,
    ),
  },
  plugins: [
    abortSignalTimeoutCompat(),
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
    // Worker bundles get their own plugin pipeline — the compat rewrite must
    // run there too (that's where @powersync/web's failing call lives).
    plugins: () => [abortSignalTimeoutCompat()],
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
