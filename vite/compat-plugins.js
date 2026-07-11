// Build-time compatibility rewrites for the kitchen display's frozen embedded
// browser (pre-Chrome-103; APIs as old as Chrome 92 confirmed missing).
//
// Page-level polyfills (src/lib/abortSignalPolyfill.js) can never reach WEB
// WORKERS — each worker has its own global scope, and @powersync/web +
// wa-sqlite run their whole storage engine inside workers. These transforms
// rewrite the dependency code itself, so the fix exists in every context:
// main bundle, workers, shared workers. Registered in BOTH vite pipelines
// (plugins and worker.plugins). First-party src/ is exempt — it uses the
// guarded helpers (utils/uuid.js) directly.
//
// Kept in a standalone module so the transforms are unit-testable
// (src/__tests__/compatPlugins.test.js).

// AbortSignal.timeout(ms) — Chrome 103. @powersync/web calls it on the WRITE
// path inside its workers (the 10.07 kitchen-display incident).
export const abortSignalTimeoutCompat = () => ({
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

// crypto.randomUUID() — Chrome 92. @powersync calls it BARE inside
// WASQLiteDB.worker / SharedSyncImplementation.worker (DB lease ids, tab
// signals): one missing function kills the local-first engine's worker on
// the old display. The negative lookbehind-ish prefix capture keeps
// `globalThis.crypto.randomUUID()` (already-guarded first-party code)
// untouched — rewriting it would splice an expression after `globalThis.`.
const UUID_FALLBACK =
  '(function(){if(typeof crypto!=="undefined"&&crypto.randomUUID)return crypto.randomUUID();' +
  'var b=new Uint8Array(16);if(typeof crypto!=="undefined"&&crypto.getRandomValues)crypto.getRandomValues(b);' +
  'else for(var i=0;i<16;i++)b[i]=Math.floor(Math.random()*256);' +
  'b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h="";for(var j=0;j<16;j++)h+=(b[j]+256).toString(16).slice(1);' +
  'return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)})()';

export const cryptoRandomUuidCompat = () => ({
  name: 'crypto-random-uuid-compat',
  transform(code, id) {
    if (!id.includes('node_modules') || !code.includes('crypto.randomUUID()')) return null;
    const next = code.replace(/(^|[^.\w])crypto\.randomUUID\(\)/g, (_, pre) => pre + UUID_FALLBACK);
    if (next === code) return null;
    return { code: next, map: null };
  },
});

// Array.prototype.toSorted/toReversed (Chrome 110), findLast/findLastIndex
// (97), and structuredClone (98) appear inside wa-sqlite's FacadeVFS and
// @powersync's shared sync worker. A small guarded prelude is prepended to
// exactly the dependency modules that use them (imports hoist, so a leading
// statement is valid ESM).
const ARRAY_PRELUDE =
  ';(function(){var A=Array.prototype;' +
  'if(!A.toSorted)A.toSorted=function(c){var a=this.slice();a.sort(c);return a};' +
  'if(!A.toReversed)A.toReversed=function(){return this.slice().reverse()};' +
  'if(!A.findLast)A.findLast=function(f,t){for(var i=this.length-1;i>=0;i--){if(f.call(t,this[i],i,this))return this[i]}};' +
  'if(!A.findLastIndex)A.findLastIndex=function(f,t){for(var i=this.length-1;i>=0;i--){if(f.call(t,this[i],i,this))return i}return -1};' +
  'if(typeof structuredClone==="undefined"){try{globalThis.structuredClone=function(x){return x===void 0?x:JSON.parse(JSON.stringify(x))}}catch(e){}}' +
  '})();\n';

const ARRAY_MARKERS = ['.toSorted(', '.toReversed(', '.findLast(', '.findLastIndex(', 'structuredClone('];

export const modernRuntimeCompat = () => ({
  name: 'modern-runtime-compat',
  transform(code, id) {
    if (!id.includes('node_modules')) return null;
    if (!ARRAY_MARKERS.some((m) => code.includes(m))) return null;
    return { code: ARRAY_PRELUDE + code, map: null };
  },
});

export const compatPlugins = () => [
  abortSignalTimeoutCompat(),
  cryptoRandomUuidCompat(),
  modernRuntimeCompat(),
];
