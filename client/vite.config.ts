import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";

/**
 * Injects a minimal browser-compatible require() shim into the renderer bundle.
 * matrix-widget-api (a dependency of matrix-js-sdk) ships CJS-only code with
 * `require("events")` calls inside function bodies that Rollup's commonjs plugin
 * cannot statically resolve. This shim provides a fallback that maps "events"
 * to EventEmitter (bundled from the `events` npm package).
 */
function browserRequireShimPlugin(): Plugin {
  const SHIM = `
if (typeof globalThis.require === 'undefined') {
  const _moduleCache = {};
  globalThis.require = function(id) {
    if (id === 'events') {
      // EventEmitter polyfill — the 'events' npm package is aliased in resolve.alias
      // and bundled by Vite. We access it via the already-executed module chunk.
      if (_moduleCache.events) return _moduleCache.events;
      // Fallback: minimal EventEmitter stub compatible with matrix-widget-api usage
      function EventEmitter() { this._events = {}; }
      EventEmitter.prototype.on = function(ev, fn) { (this._events[ev] = this._events[ev] || []).push(fn); return this; };
      EventEmitter.prototype.off = function(ev, fn) { if (this._events[ev]) this._events[ev] = this._events[ev].filter(f => f !== fn); return this; };
      EventEmitter.prototype.removeListener = EventEmitter.prototype.off;
      EventEmitter.prototype.once = function(ev, fn) { const wrap = (...a) => { this.off(ev, wrap); fn.apply(this, a); }; return this.on(ev, wrap); };
      EventEmitter.prototype.emit = function(ev, ...args) { (this._events[ev] || []).forEach(f => f.apply(this, args)); return this; };
      EventEmitter.prototype.removeAllListeners = function(ev) { if (ev) delete this._events[ev]; else this._events = {}; return this; };
      EventEmitter.prototype.listeners = function(ev) { return this._events[ev] || []; };
      EventEmitter.prototype.listenerCount = function(ev) { return (this._events[ev] || []).length; };
      EventEmitter.defaultMaxListeners = 10;
      _moduleCache.events = { EventEmitter, default: EventEmitter };
      return _moduleCache.events;
    }
    throw new Error('require(' + id + ') is not supported in the renderer bundle');
  };
}
`.trim();

  return {
    name: "browser-require-shim",
    apply: "build",
    // Inject the shim as a module that runs before the entry chunk
    renderChunk(code, chunk) {
      // Only inject into the main entry chunk (contains React + matrix-js-sdk)
      if (chunk.isEntry) {
        return { code: SHIM + "\n" + code, map: null };
      }
      return null;
    },
  };
}

/**
 * M2: inject a Content-Security-Policy meta tag into the production index.html.
 * Build-only (`apply: "build"`) so the Vite dev server / HMR (which need
 * 'unsafe-eval' + ws:) keep working. script-src 'self' is correct for the
 * file://-loaded packaged app (its bundled scripts are same-origin). connect-src
 * allows https/wss for arbitrary Matrix homeservers + LiveKit.
 */
function cspPlugin(): Plugin {
  const CSP = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' is required by matrix-js-sdk's Rust crypto (WASM E2EE).
    // It permits WebAssembly compilation only — NOT general eval()/string-to-code.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
  return {
    name: "hailfreq-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  define: {
    // L1: compile out the HAILFREQ_TEST gate in the production renderer bundle.
    // That gate exposes window.__matrixHandle (incl. the Matrix access token) and
    // window.__voiceEngine; inlining "0" here lets the bundler dead-strip it so a
    // stray env var in a shipped build can never enable it. Test builds pass
    // HAILFREQ_TEST=1 to `vite build` explicitly.
    "process.env.HAILFREQ_TEST": JSON.stringify(process.env.HAILFREQ_TEST ?? "0"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "src/shared"),
      // matrix-js-sdk uses Node's `events` EventEmitter; alias to the browser polyfill.
      // Without this, the renderer bundle contains bare require("events") calls that
      // fail at runtime in Electron with nodeIntegration:false.
      events: resolve(__dirname, "node_modules/events/events.js"),
    },
  },
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
            // The main bundle is ESM (index.mjs). CJS deps must be transformed or
            // their `module.exports` leaks into ES-module scope at runtime
            // ("ReferenceError: module is not defined in ES module scope").
            // vite's default commonjs `include` is node_modules-only, which misses
            // the local stub (stubs/empty-package — a file: dep pulled into the
            // main process via active-win → node-pre-gyp → mock-aws-s3, and reached
            // through a symlink that resolves OUTSIDE node_modules). Include it.
            commonjsOptions: {
              include: [/node_modules/, /stubs[\\/]empty-package/],
              transformMixedEsModules: true,
            },
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            // M1: the preload MUST be CJS for sandbox:true (an ESM `import` →
            // "Cannot use import statement outside a module" at preload load).
            //
            // vite-plugin-electron auto-builds a lib from `entry`, defaulting
            // formats to ["es"] because package.json is "type":"module". Vite's
            // mergeConfig CONCATENATES arrays, so our formats:["cjs"] merges to
            // ["es","cjs"] — BOTH formats build. A constant fileName ("index.cjs")
            // then makes both outputs target the same file, so they overwrite
            // each other: `vite build` happened to let CJS win, but `vite`
            // (serve/watch) let ESM win — breaking `npm run dev`, and a partial
            // overwrite left a syntactically-broken hybrid ("Unexpected token").
            //
            // Fix: give each format a DISTINCT filename so they can't collide.
            // Electron loads index.cjs (always CJS); index.mjs is unused output.
            lib: {
              entry: "src/preload/index.ts",
              formats: ["cjs"],
              fileName: (format) => (format === "cjs" ? "index.cjs" : "index.mjs"),
            },
            rollupOptions: { external: ["electron"] },
          },
        },
      },
    ]),
    renderer(),
    browserRequireShimPlugin(),
    cspPlugin(),
  ],
  build: {
    outDir: "dist",
    // Ensure CJS modules in node_modules (matrix-widget-api etc.) are properly
    // transformed by Rollup's built-in commonjs plugin.
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ["matrix-js-sdk", "matrix-widget-api"],
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});
