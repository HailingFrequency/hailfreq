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

export default defineConfig({
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
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
          },
        },
      },
    ]),
    renderer(),
    browserRequireShimPlugin(),
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
