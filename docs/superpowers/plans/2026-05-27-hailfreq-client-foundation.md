# Hailfreq Client Foundation Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Hailfreq desktop client (Electron + React + TypeScript, Windows + Linux) that handles first-run server configuration, login via CitizenID OIDC or local Synapse accounts, full Matrix E2E encryption setup (cross-signing + key backup + Recovery Key), and SAS device verification. After this plan, members can install Hailfreq, sign into a guild's server, complete the privacy-critical onboarding, and have a verified device that can decrypt encrypted messages. **No tactical-radio features.** Those are Plans 4 and beyond.

**Architecture:** Electron app split into main process (Node.js — handles OS, secure storage, OIDC callbacks, IPC) and renderer (React — handles all UI). Uses matrix-js-sdk for Matrix protocol + crypto. Persistent settings stored in Electron's userData via `electron-store`. Tokens stored encrypted via Electron's `safeStorage` API. CitizenID OIDC uses browser-redirect + loopback callback listener pattern (works reliably on both Windows and Linux). Cross-signing + key backup follow Element's reference implementation patterns.

**Tech Stack:** Electron 42+, React 18, TypeScript 5, Vite 5 (dev + build), Tailwind CSS 3, matrix-js-sdk 35+ (with included Olm/cross-signing/SSSS support), Vitest (unit), Playwright (E2E with Electron driver), electron-builder (distribution).

**Scope reference:** Implements §2.1, §4.2, §7.1, §7.2, §7.3, §7.4, §7.6 of the Hailfreq design spec (`docs/superpowers/specs/2026-05-26-hailfreq-design.md`). Does NOT implement multi-server sidebar (Plan 3), tactical-radio multi-net voice (Plan 4), or admin board (Plan 5).

**Repo location:** All deliverables go under `client/` in the existing `tactical-radio` repo.

**Out of scope for this plan:** the Hailfreq tactical-radio UX, voice features, admin board, multi-server. Plan 2's "Home" screen is a placeholder room list — enough to prove login + encryption work end-to-end. Plans 3–5 build the actual product on this foundation.

---

## Task 1: Client repo scaffolding

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/tsconfig.node.json`
- Create: `client/vite.config.ts`
- Create: `client/.gitignore`
- Create: `client/README.md`
- Create: `client/index.html`

- [ ] **Step 1: Create directory structure**

```bash
cd /home/shreen/code/tactical-radio
mkdir -p client/src/{main,preload,renderer,shared} client/src/renderer/{screens,components,matrix} client/assets client/tests/{unit,e2e}
```

- [ ] **Step 2: Write `client/package.json`**

```json
{
  "name": "hailfreq-client",
  "version": "0.1.0",
  "description": "Privacy-first Matrix desktop client for tactical voice ops",
  "private": true,
  "type": "module",
  "main": "dist-electron/main/index.cjs",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "start": "electron .",
    "dist:linux": "electron-builder --linux AppImage",
    "dist:windows": "electron-builder --win nsis",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "matrix-js-sdk": "^35.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "electron-store": "^10.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "electron": "^42.0.0",
    "electron-builder": "^25.0.0",
    "playwright": "^1.49.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vite-plugin-electron": "^0.29.0",
    "vite-plugin-electron-renderer": "^0.14.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Write `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Write `client/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist-electron",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "vite.config.ts"]
}
```

- [ ] **Step 5: Write `client/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "src/shared"),
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
            rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: "dist",
  },
});
```

- [ ] **Step 6: Write `client/.gitignore`**

```
node_modules/
dist/
dist-electron/
release/
*.log
.env
.env.local
.DS_Store
.vite/
.vitest-cache/
playwright-report/
test-results/
```

- [ ] **Step 7: Write `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hailfreq</title>
  </head>
  <body class="bg-slate-900 text-slate-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `client/README.md`**

```markdown
# Hailfreq Client

Privacy-first Matrix desktop client. See `docs/build.md` for build and run instructions.

## Quick start

```bash
npm ci
npm run dev          # development with HMR
npm run build        # production build
npm run dist:linux   # AppImage
npm run dist:windows # nsis installer (cross-build supported on Linux with wine; native on Windows)
```
```

- [ ] **Step 9: Install dependencies and verify**

```bash
cd client
npm install
# Expected: install completes; node_modules/ exists; no critical errors
ls node_modules/electron node_modules/matrix-js-sdk node_modules/react
```

- [ ] **Step 10: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/package.json client/tsconfig*.json client/vite.config.ts client/.gitignore client/index.html client/README.md
git commit -m "client: scaffold electron + react + vite project"
```

---

## Task 2: Electron main process — boot + single window

**Files:**
- Create: `client/src/main/index.ts`
- Create: `client/src/main/window.ts`

- [ ] **Step 1: Write `client/src/main/window.ts`**

```ts
import { BrowserWindow, app } from "electron";
import path from "node:path";

const isDev = !app.isPackaged;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0f172a",
    title: "Hailfreq",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}
```

- [ ] **Step 2: Write `client/src/main/index.ts`**

```ts
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Prevent navigation to arbitrary URLs (defense in depth)
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith(process.env.VITE_DEV_SERVER_URL || "")
      || url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
```

- [ ] **Step 3: Verify dev mode boots**

```bash
cd client
npm run dev &
DEV_PID=$!
sleep 8
ps -p $DEV_PID >/dev/null && echo "dev server running"
kill $DEV_PID 2>/dev/null
# Note: a window should have briefly appeared. Visual verification not strictly required for this task; subsequent tasks will exercise actual UI.
```

- [ ] **Step 4: Commit**

```bash
git add client/src/main/
git commit -m "client: electron main process with single BrowserWindow"
```

---

## Task 3: Renderer baseline — React + Tailwind

**Files:**
- Create: `client/src/renderer/main.tsx`
- Create: `client/src/renderer/App.tsx`
- Create: `client/src/renderer/index.css`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`

- [ ] **Step 1: Write `client/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfeff",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Write `client/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Write `client/src/renderer/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
}
```

- [ ] **Step 4: Write `client/src/renderer/App.tsx`**

```tsx
export function App() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-brand-400">Hailfreq</h1>
        <p className="mt-2 text-slate-400">Privacy-first Matrix client</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `client/src/renderer/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Verify renderer compiles**

```bash
cd client
npm run build 2>&1 | tail -20
# Expected: build succeeds; dist/ contains index.html and assets/
ls dist/
```

- [ ] **Step 7: Commit**

```bash
git add client/src/renderer/ client/tailwind.config.js client/postcss.config.js
git commit -m "client: react renderer with tailwind baseline"
```

---

## Task 4: Type-safe IPC bridge

**Files:**
- Create: `client/src/shared/ipc.ts`
- Create: `client/src/preload/index.ts`
- Create: `client/src/main/ipc.ts`
- Modify: `client/src/main/index.ts` (register IPC handlers)
- Modify: `client/src/renderer/App.tsx` (smoke-test by calling app:version)

The IPC pattern: a single `IpcChannels` map in `shared/ipc.ts` is the source of truth for which channels exist and what they return. Preload exposes a typed `window.hailfreq` API. Main process registers handlers matching the same shape.

- [ ] **Step 1: Write `client/src/shared/ipc.ts`**

```ts
// Source of truth for all IPC channels. Add new channels here.
export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
}

export type IpcChannelName = keyof IpcChannels;
```

- [ ] **Step 2: Write `client/src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannelName, IpcChannels } from "../shared/ipc";

const api = {
  invoke: <K extends IpcChannelName>(
    channel: K,
    ...args: IpcChannels[K]["args"]
  ): Promise<IpcChannels[K]["result"]> => ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld("hailfreq", api);

declare global {
  interface Window {
    hailfreq: typeof api;
  }
}
```

- [ ] **Step 3: Write `client/src/main/ipc.ts`**

```ts
import { app, ipcMain } from "electron";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);
}
```

- [ ] **Step 4: Modify `client/src/main/index.ts`** — register handlers before window creation

Add an import: `import { registerIpcHandlers } from "./ipc";`

Modify the `app.whenReady().then(...)` block to register handlers before creating the window:

```ts
app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});
```

- [ ] **Step 5: Smoke-test in `client/src/renderer/App.tsx`** — show app version

```tsx
import { useEffect, useState } from "react";

export function App() {
  const [version, setVersion] = useState<string>("…");
  const [platform, setPlatform] = useState<string>("…");

  useEffect(() => {
    void window.hailfreq.invoke("app:version").then(setVersion);
    void window.hailfreq.invoke("app:platform").then(setPlatform);
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-brand-400">Hailfreq</h1>
        <p className="mt-2 text-slate-400">Privacy-first Matrix client</p>
        <p className="mt-6 text-xs text-slate-500">
          v{version} · {platform}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build still passes**

```bash
cd client
npm run build 2>&1 | tail -10
# Expected: success
```

- [ ] **Step 7: Commit**

```bash
git add client/src/shared/ client/src/preload/ client/src/main/ client/src/renderer/App.tsx
git commit -m "client: type-safe IPC bridge between main and renderer"
```

---

## Task 5: Persistent settings store

**Files:**
- Create: `client/src/main/store.ts`
- Modify: `client/src/main/ipc.ts` (add settings IPC channels)
- Modify: `client/src/shared/ipc.ts` (add channel types)

Store: server URL, current user ID (if logged in), and a few app preferences (theme, last login method). Stored in Electron's userData via `electron-store`. NO secrets here — those go to safeStorage in Task 10.

- [ ] **Step 1: Write `client/src/main/store.ts`**

```ts
import Store from "electron-store";

export interface Settings {
  /** Homeserver URL configured during first-run. Empty means first-run not done. */
  serverUrl: string;
  /** Last logged-in Matrix user ID, for auto-resume. Empty when logged out. */
  userId: string;
  /** Which login method was last used: "citizenid" or "local". */
  lastLoginMethod: "" | "citizenid" | "local";
  /** UI preferences. */
  ui: {
    theme: "dark";
  };
}

const defaults: Settings = {
  serverUrl: "",
  userId: "",
  lastLoginMethod: "",
  ui: { theme: "dark" },
};

export const settings = new Store<Settings>({
  name: "settings",
  defaults,
  // Lightweight schema validation — keeps the store from accumulating garbage
  schema: {
    serverUrl: { type: "string" },
    userId: { type: "string" },
    lastLoginMethod: { type: "string", enum: ["", "citizenid", "local"] },
    ui: {
      type: "object",
      properties: { theme: { type: "string", enum: ["dark"] } },
    },
  } as any,
});
```

- [ ] **Step 2: Extend `client/src/shared/ipc.ts`**

```ts
import type { Settings } from "../main/store";

export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
  "settings:get": { args: []; result: Settings };
  "settings:set": { args: [Partial<Settings>]; result: Settings };
}

export type IpcChannelName = keyof IpcChannels;
```

Note: importing from `../main/store` in shared code is technically a layering violation. Acceptable here because `Settings` is a pure data type with no Electron dependency. If this bothers you in review, hoist the `Settings` type into `shared/types.ts` instead.

- [ ] **Step 3: Add IPC handlers in `client/src/main/ipc.ts`**

```ts
import { app, ipcMain } from "electron";
import { settings, type Settings } from "./store";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  ipcMain.handle("settings:get", (): Settings => settings.store);
  ipcMain.handle("settings:set", (_event, partial: Partial<Settings>): Settings => {
    for (const [key, value] of Object.entries(partial)) {
      settings.set(key as keyof Settings, value as never);
    }
    return settings.store;
  });
}
```

- [ ] **Step 4: Verify build**

```bash
cd client
npm run build 2>&1 | tail -5
# Expected: success
```

- [ ] **Step 5: Commit**

```bash
git add client/src/main/store.ts client/src/main/ipc.ts client/src/shared/ipc.ts
git commit -m "client: persistent settings store via electron-store"
```

---

## Task 6: First-run screen — server URL configuration

**Files:**
- Create: `client/src/renderer/screens/FirstRun.tsx`
- Create: `client/src/renderer/components/Button.tsx`
- Create: `client/src/renderer/components/Input.tsx`

This screen takes a URL like `https://radio.your-guild.com`, normalizes it (strip trailing slash, ensure https), and probes `/_matrix/client/versions` to confirm it's a Matrix homeserver before saving.

- [ ] **Step 1: Write `client/src/renderer/components/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-brand-500 text-slate-900 hover:bg-brand-400",
    ghost: "border border-slate-700 text-slate-200 hover:bg-slate-800",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Write `client/src/renderer/components/Input.tsx`**

```tsx
import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, className = "", ...rest }: InputProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        className={`rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none ${className}`}
        {...rest}
      />
      {hint && !error && <span className="text-xs text-slate-500">{hint}</span>}
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 3: Write `client/src/renderer/screens/FirstRun.tsx`**

```tsx
import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

interface FirstRunProps {
  onConfigured: (serverUrl: string) => void;
}

function normalizeUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

async function probeHomeserver(url: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${url}/_matrix/client/versions`, { method: "GET" });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const body = await r.json();
    if (!Array.isArray(body?.versions)) return { ok: false, reason: "not a Matrix homeserver" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unreachable" };
  }
}

export function FirstRun({ onConfigured }: FirstRunProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const normalized = normalizeUrl(url);
    const probe = await probeHomeserver(normalized);
    setBusy(false);
    if (!probe.ok) {
      setError(`Could not reach Matrix homeserver at ${normalized}: ${probe.reason}`);
      return;
    }
    await window.hailfreq.invoke("settings:set", { serverUrl: normalized });
    onConfigured(normalized);
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">Welcome to Hailfreq</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your guild's Hailfreq server address to get started.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Server URL"
          placeholder="radio.your-guild.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          required
          hint="Your guild admin will share this with you."
          error={error || undefined}
        />
        <Button type="submit" disabled={!url.trim() || busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd client
npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/screens/FirstRun.tsx client/src/renderer/components/
git commit -m "client: first-run screen for server URL configuration"
```

---

## Task 7: App-level state machine + routing

**Files:**
- Create: `client/src/renderer/AppState.tsx`
- Modify: `client/src/renderer/App.tsx` (delegate to AppState)

State machine: `loading` → `first-run` (if no serverUrl) → `login` (if no session) → `encryption-setup` (if first-time) → `home`.

- [ ] **Step 1: Write `client/src/renderer/AppState.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { FirstRun } from "./screens/FirstRun";

type Screen =
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "login"; serverUrl: string }
  | { kind: "home"; serverUrl: string; userId: string };

export function AppState() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    void window.hailfreq.invoke("settings:get").then((s) => {
      if (!s.serverUrl) {
        setScreen({ kind: "first-run" });
      } else if (!s.userId) {
        setScreen({ kind: "login", serverUrl: s.serverUrl });
      } else {
        // Auto-resume path is wired up in Task 11; for now we always go to login.
        setScreen({ kind: "login", serverUrl: s.serverUrl });
      }
    });
  }, []);

  switch (screen.kind) {
    case "loading":
      return <CenteredMessage>Loading…</CenteredMessage>;
    case "first-run":
      return <FirstRun onConfigured={(url) => setScreen({ kind: "login", serverUrl: url })} />;
    case "login":
      return (
        <CenteredMessage>
          Login screen for {screen.serverUrl} (wired in Task 9)
        </CenteredMessage>
      );
    case "home":
      return <CenteredMessage>Home shell for {screen.userId} (wired in Task 20)</CenteredMessage>;
  }
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 2: Modify `client/src/renderer/App.tsx`** to delegate

```tsx
import { AppState } from "./AppState";

export function App() {
  return <AppState />;
}
```

- [ ] **Step 3: Verify build**

```bash
cd client
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/AppState.tsx client/src/renderer/App.tsx
git commit -m "client: app-level state machine routing between screens"
```

---

## Task 8: matrix-js-sdk client wrapper

**Files:**
- Create: `client/src/renderer/matrix/client.ts`
- Create: `client/src/renderer/matrix/types.ts`

A thin wrapper around `matrix-js-sdk` that exposes a typed instance, plus utilities for login and session resumption. Renderer-side (not main) because matrix-js-sdk targets browser environments and needs Web Crypto. (We trust the Electron renderer because of contextIsolation + sandbox.)

- [ ] **Step 1: Write `client/src/renderer/matrix/types.ts`**

```ts
export interface Credentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

export type LoginMethod = "citizenid" | "local";
```

- [ ] **Step 2: Write `client/src/renderer/matrix/client.ts`**

```ts
import { createClient, MatrixClient } from "matrix-js-sdk";
import type { Credentials } from "./types";

export interface ClientHandle {
  client: MatrixClient;
  shutdown(): Promise<void>;
}

/**
 * Create and start a matrix-js-sdk client from cached credentials.
 * Caller is responsible for calling `shutdown()` on logout / unmount.
 */
export async function startClient(creds: Credentials): Promise<ClientHandle> {
  const client = createClient({
    baseUrl: creds.homeserverUrl,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
  });

  await client.initCrypto();
  await client.startClient({ initialSyncLimit: 10 });

  return {
    client,
    async shutdown() {
      client.stopClient();
      await client.logout(true).catch(() => undefined);
    },
  };
}

/**
 * Local-account password login. Returns a Credentials bundle the caller can persist.
 */
export async function loginWithPassword(
  homeserverUrl: string,
  username: string,
  password: string,
): Promise<Credentials> {
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = await tmp.login("m.login.password", {
    identifier: { type: "m.id.user", user: username },
    password,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl,
  };
}

/**
 * Probe the homeserver for the list of supported login flows.
 * Used by the login screen to decide whether to show the CitizenID button
 * (only if `m.login.sso` with `org.matrix.msc3824.delegated_oidc_compatibility`
 * or just any `m.login.sso` is offered).
 */
export async function getLoginFlows(homeserverUrl: string): Promise<{
  supportsLocalPassword: boolean;
  supportsOidcSso: boolean;
  ssoIdentityProviders: { id: string; name: string; brand?: string }[];
}> {
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = (await tmp.loginFlows()) as {
    flows: { type: string; identity_providers?: { id: string; name: string; brand?: string }[] }[];
  };
  const sso = resp.flows.find((f) => f.type === "m.login.sso");
  return {
    supportsLocalPassword: resp.flows.some((f) => f.type === "m.login.password"),
    supportsOidcSso: !!sso,
    ssoIdentityProviders: sso?.identity_providers ?? [],
  };
}
```

- [ ] **Step 3: Verify build**

```bash
cd client
npm run build 2>&1 | tail -10
# Expected: no errors. Some warnings about peer deps from matrix-js-sdk are normal.
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/matrix/
git commit -m "client: matrix-js-sdk client wrapper with login + loginFlows utilities"
```

---

## Task 9: Local-account login screen + flow

**Files:**
- Create: `client/src/renderer/screens/Login.tsx`
- Modify: `client/src/renderer/AppState.tsx` (wire login screen + post-login transition)

- [ ] **Step 1: Write `client/src/renderer/screens/Login.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { getLoginFlows, loginWithPassword } from "../matrix/client";
import type { Credentials } from "../matrix/types";

interface LoginProps {
  serverUrl: string;
  onLoggedIn: (creds: Credentials) => void;
}

type Flows = {
  supportsLocalPassword: boolean;
  supportsOidcSso: boolean;
  ssoIdentityProviders: { id: string; name: string; brand?: string }[];
};

export function Login({ serverUrl, onLoggedIn }: LoginProps) {
  const [flows, setFlows] = useState<Flows | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLoginFlows(serverUrl)
      .then(setFlows)
      .catch((e) => setError(`Could not contact server: ${e instanceof Error ? e.message : e}`));
  }, [serverUrl]);

  async function handleLocalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const creds = await loginWithPassword(serverUrl, username, password);
      await window.hailfreq.invoke("settings:set", {
        userId: creds.userId,
        lastLoginMethod: "local",
      });
      onLoggedIn(creds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  if (!flows && !error) {
    return <Centered>Loading login options…</Centered>;
  }
  if (error && !flows) {
    return <Centered>{error}</Centered>;
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">{serverUrl}</p>
      </header>

      {/* CitizenID button — wired in Task 14 */}
      {flows?.supportsOidcSso && (
        <Button variant="primary" disabled title="Wired in Task 14">
          Sign in with CitizenID (coming soon)
        </Button>
      )}

      {flows?.supportsLocalPassword && (
        <form onSubmit={handleLocalSubmit} className="flex flex-col gap-4">
          <Input
            label="Username"
            placeholder="yourname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <Input
            label="Password"
            type="password"
            placeholder="•••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            error={error || undefined}
          />
          <Button type="submit" disabled={!username || !password || busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `client/src/renderer/AppState.tsx`**

Replace the `case "login":` placeholder with the real Login screen, and add a `home` transition. The actual `home` screen is Task 20; for this task it stays as a CenteredMessage placeholder.

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { FirstRun } from "./screens/FirstRun";
import { Login } from "./screens/Login";
import type { Credentials } from "./matrix/types";

type Screen =
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "login"; serverUrl: string }
  | { kind: "home"; serverUrl: string; userId: string; creds: Credentials };

export function AppState() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    void window.hailfreq.invoke("settings:get").then((s) => {
      if (!s.serverUrl) setScreen({ kind: "first-run" });
      else setScreen({ kind: "login", serverUrl: s.serverUrl });
    });
  }, []);

  switch (screen.kind) {
    case "loading":
      return <CenteredMessage>Loading…</CenteredMessage>;
    case "first-run":
      return <FirstRun onConfigured={(url) => setScreen({ kind: "login", serverUrl: url })} />;
    case "login":
      return (
        <Login
          serverUrl={screen.serverUrl}
          onLoggedIn={(creds) =>
            setScreen({ kind: "home", serverUrl: screen.serverUrl, userId: creds.userId, creds })
          }
        />
      );
    case "home":
      return <CenteredMessage>Logged in as {screen.userId} (Home shell — Task 20)</CenteredMessage>;
  }
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd client
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/screens/Login.tsx client/src/renderer/AppState.tsx
git commit -m "client: local-account login screen wired into state machine"
```

---

## Task 10: Secure token persistence via safeStorage

**Files:**
- Create: `client/src/main/tokens.ts`
- Modify: `client/src/main/ipc.ts` (add token IPC channels)
- Modify: `client/src/shared/ipc.ts` (add channel types)
- Modify: `client/src/renderer/screens/Login.tsx` (save tokens via IPC after login)

Tokens get encrypted at rest using Electron's `safeStorage` API (which uses the OS keyring on Linux/Windows when available, or falls back to a basic encrypt scheme). Tokens are never written to plain disk.

- [ ] **Step 1: Write `client/src/main/tokens.ts`**

```ts
import { safeStorage, app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

function tokenFilePath(): string {
  return path.join(app.getPath("userData"), "credentials.enc");
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable; refusing to store tokens unencrypted.");
  }
  const json = JSON.stringify(creds);
  const buf = safeStorage.encryptString(json);
  await fs.writeFile(tokenFilePath(), buf, { mode: 0o600 });
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const buf = await fs.readFile(tokenFilePath());
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredCredentials;
  } catch (err) {
    if (isNoEntError(err)) return null;
    throw err;
  }
}

export async function clearCredentials(): Promise<void> {
  await fs.rm(tokenFilePath(), { force: true });
}

function isNoEntError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
```

- [ ] **Step 2: Extend `client/src/shared/ipc.ts`**

```ts
import type { Settings } from "../main/store";

export interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
  "settings:get": { args: []; result: Settings };
  "settings:set": { args: [Partial<Settings>]; result: Settings };
  "tokens:save": { args: [StoredCredentials]; result: void };
  "tokens:load": { args: []; result: StoredCredentials | null };
  "tokens:clear": { args: []; result: void };
}

export type IpcChannelName = keyof IpcChannels;
```

- [ ] **Step 3: Register handlers in `client/src/main/ipc.ts`**

```ts
import { app, ipcMain } from "electron";
import { settings, type Settings } from "./store";
import { saveCredentials, loadCredentials, clearCredentials } from "./tokens";
import type { StoredCredentials } from "../shared/ipc";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  ipcMain.handle("settings:get", (): Settings => settings.store);
  ipcMain.handle("settings:set", (_event, partial: Partial<Settings>): Settings => {
    for (const [key, value] of Object.entries(partial)) {
      settings.set(key as keyof Settings, value as never);
    }
    return settings.store;
  });

  ipcMain.handle("tokens:save", (_event, creds: StoredCredentials) => saveCredentials(creds));
  ipcMain.handle("tokens:load", () => loadCredentials());
  ipcMain.handle("tokens:clear", () => clearCredentials());
}
```

- [ ] **Step 4: Modify `client/src/renderer/screens/Login.tsx`**

Inside `handleLocalSubmit`, after successful login, save the tokens via IPC:

```tsx
const creds = await loginWithPassword(serverUrl, username, password);
await window.hailfreq.invoke("tokens:save", creds);
await window.hailfreq.invoke("settings:set", {
  userId: creds.userId,
  lastLoginMethod: "local",
});
onLoggedIn(creds);
```

- [ ] **Step 5: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add client/src/main/tokens.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/renderer/screens/Login.tsx
git commit -m "client: encrypted token persistence via electron safeStorage"
```

---

## Task 11: Auto-login + token refresh on relaunch

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (check stored tokens on boot; resume session)
- Modify: `client/src/renderer/matrix/client.ts` (handle token-expired errors)

- [ ] **Step 1: Modify `AppState.tsx`** — check tokens on boot

Replace the `useEffect` boot logic:

```tsx
useEffect(() => {
  void (async () => {
    const s = await window.hailfreq.invoke("settings:get");
    if (!s.serverUrl) {
      setScreen({ kind: "first-run" });
      return;
    }
    const stored = await window.hailfreq.invoke("tokens:load");
    if (stored && stored.userId === s.userId) {
      // Validate token by hitting /_matrix/client/v3/account/whoami
      const ok = await validateAccessToken(stored.homeserverUrl, stored.accessToken);
      if (ok) {
        setScreen({ kind: "home", serverUrl: s.serverUrl, userId: stored.userId, creds: stored });
        return;
      }
      // Token rejected — clear and force login
      await window.hailfreq.invoke("tokens:clear");
      await window.hailfreq.invoke("settings:set", { userId: "" });
    }
    setScreen({ kind: "login", serverUrl: s.serverUrl });
  })();
}, []);
```

Add the helper at the bottom of the file:

```tsx
async function validateAccessToken(homeserverUrl: string, accessToken: string): Promise<boolean> {
  try {
    const r = await fetch(`${homeserverUrl}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/AppState.tsx
git commit -m "client: auto-resume session from stored tokens on app launch"
```

---

## Task 12: CitizenID OIDC — main-process callback listener

**Files:**
- Create: `client/src/main/oidc.ts`
- Modify: `client/src/main/ipc.ts` (add OIDC channels)
- Modify: `client/src/shared/ipc.ts` (add channel types)

CitizenID OIDC flow:
1. Renderer asks main to start OIDC: main computes a PKCE pair, spawns a one-shot local HTTP listener on a free loopback port, builds the auth URL, opens it in the user's default browser.
2. User authenticates at citizenid.space, gets redirected to `http://127.0.0.1:<port>/callback?code=...`.
3. Local listener receives the redirect, hands the code back to the main process, shuts itself down.
4. Main exchanges code for tokens at CitizenID's token endpoint, then performs Matrix-side OIDC SSO redirect to Synapse to get a Matrix access token.

This task implements steps 1–3 plus the CitizenID-side token exchange. Step 4 (Matrix SSO redirect) ties in via the Synapse `m.login.sso` flow, handled in Task 14.

- [ ] **Step 1: Write `client/src/main/oidc.ts`**

```ts
import { shell, BrowserWindow } from "electron";
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

interface OidcStartParams {
  homeserverUrl: string;     // Synapse base URL, e.g., https://radio.guild.com
  idpId: string;             // e.g., "citizenid" — the identity provider ID returned by /_matrix/client/v3/login
}

interface OidcResult {
  loginToken: string;        // Matrix `m.login.token` returned at the end of the SSO flow
}

/**
 * Run the SSO flow:
 *   1. Spin up a loopback HTTP listener on a random port.
 *   2. Open the user's default browser at the Synapse SSO redirect endpoint.
 *   3. Wait for the redirect that contains `?loginToken=...`.
 *   4. Resolve with the token; the renderer then calls m.login.token to finalize.
 */
export async function runSsoFlow(params: OidcStartParams): Promise<OidcResult> {
  const { port, server, settled } = await startLoopbackListener();
  const redirectUrl = `http://127.0.0.1:${port}/callback`;

  // Build Synapse SSO redirect URL — Synapse handles the OIDC dance internally;
  // we just need to send the user to /sso/redirect with our local redirect_url.
  const ssoUrl = new URL(
    `/_matrix/client/v3/login/sso/redirect/${encodeURIComponent(params.idpId)}`,
    params.homeserverUrl,
  );
  ssoUrl.searchParams.set("redirectUrl", redirectUrl);

  await shell.openExternal(ssoUrl.toString());

  try {
    const result = await settled;
    return result;
  } finally {
    server.close();
  }
}

async function startLoopbackListener(): Promise<{
  port: number;
  server: http.Server;
  settled: Promise<OidcResult>;
}> {
  return new Promise((resolveOuter, rejectOuter) => {
    const server = http.createServer();
    let settle: ((r: OidcResult) => void) | null = null;
    let reject: ((e: Error) => void) | null = null;
    const settled = new Promise<OidcResult>((res, rej) => {
      settle = res;
      reject = rej;
    });
    // Safety: time out after 5 minutes
    const timeout = setTimeout(() => {
      reject?.(new Error("SSO timed out (5 minutes)"));
      server.close();
    }, 5 * 60_000);

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const loginToken = url.searchParams.get("loginToken");
      if (!loginToken) {
        res.statusCode = 400;
        res.end("missing loginToken");
        reject?.(new Error("No loginToken in SSO callback"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(SSO_SUCCESS_HTML);
      clearTimeout(timeout);
      settle?.({ loginToken });
    });

    server.on("error", (err) => rejectOuter(err));

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        resolveOuter({ port: addr.port, server, settled });
      } else {
        rejectOuter(new Error("Could not bind loopback listener"));
      }
    });
  });
}

const SSO_SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{color:#22d3ee}</style></head>
<body><div><h1>Signed in to Hailfreq</h1>
<p>You can close this tab and return to the app.</p></div></body></html>`;
```

- [ ] **Step 2: Extend `client/src/shared/ipc.ts`**

```ts
"oidc:startSsoFlow": {
  args: [{ homeserverUrl: string; idpId: string }];
  result: { loginToken: string };
};
```

(Add this entry to the IpcChannels interface alongside the existing channels.)

- [ ] **Step 3: Register handler in `client/src/main/ipc.ts`**

```ts
import { runSsoFlow } from "./oidc";

// inside registerIpcHandlers():
ipcMain.handle("oidc:startSsoFlow", (_event, params: { homeserverUrl: string; idpId: string }) =>
  runSsoFlow(params),
);
```

- [ ] **Step 4: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add client/src/main/oidc.ts client/src/main/ipc.ts client/src/shared/ipc.ts
git commit -m "client: main-process OIDC SSO flow via loopback callback listener"
```

---

## Task 13: CitizenID OIDC — renderer integration

**Files:**
- Modify: `client/src/renderer/matrix/client.ts` (add loginWithToken)
- Modify: `client/src/renderer/screens/Login.tsx` (wire CitizenID button)

- [ ] **Step 1: Add `loginWithToken` to `client/src/renderer/matrix/client.ts`**

```ts
export async function loginWithToken(
  homeserverUrl: string,
  loginToken: string,
): Promise<Credentials> {
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = await tmp.login("m.login.token", {
    token: loginToken,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl,
  };
}
```

- [ ] **Step 2: Wire the CitizenID button in `client/src/renderer/screens/Login.tsx`**

Replace the disabled placeholder button with a working handler. Add this function inside the component:

```tsx
async function handleCitizenIdLogin() {
  setError(null);
  setBusy(true);
  try {
    // Find CitizenID's identity provider entry — Synapse returns these in loginFlows
    const idp = flows?.ssoIdentityProviders.find((p) => p.id === "citizenid")
      ?? flows?.ssoIdentityProviders[0];
    if (!idp) throw new Error("No CitizenID provider configured on this server");

    const { loginToken } = await window.hailfreq.invoke("oidc:startSsoFlow", {
      homeserverUrl: serverUrl,
      idpId: idp.id,
    });
    const creds = await loginWithToken(serverUrl, loginToken);
    await window.hailfreq.invoke("tokens:save", creds);
    await window.hailfreq.invoke("settings:set", {
      userId: creds.userId,
      lastLoginMethod: "citizenid",
    });
    onLoggedIn(creds);
  } catch (err) {
    setError(err instanceof Error ? err.message : "CitizenID sign-in failed");
  } finally {
    setBusy(false);
  }
}
```

Replace the disabled button JSX with:

```tsx
{flows?.supportsOidcSso && (
  <Button onClick={handleCitizenIdLogin} disabled={busy}>
    {busy ? "Waiting for browser…" : "Sign in with CitizenID"}
  </Button>
)}
```

Also import `loginWithToken` at the top of the file:

```tsx
import { getLoginFlows, loginWithPassword, loginWithToken } from "../matrix/client";
```

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/matrix/client.ts client/src/renderer/screens/Login.tsx
git commit -m "client: wire CitizenID SSO button into login screen"
```

---

## Task 14: Encryption bootstrap — initialize crypto + cross-signing

**Files:**
- Create: `client/src/renderer/matrix/crypto.ts`

After login, the client must initialize crypto state. `client.initCrypto()` (called in startClient) loads any existing keys; this task adds the "first-time setup" logic that creates fresh cross-signing keys if none exist.

- [ ] **Step 1: Write `client/src/renderer/matrix/crypto.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";

/**
 * Returns true if this account already has cross-signing master keys published
 * (i.e., it's been bootstrapped on some device, even if not this one).
 */
export async function hasCrossSigning(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");
  const status = await crypto.getCrossSigningStatus();
  return status.publicKeysOnServer;
}

/**
 * Returns true if this *device* is cross-signed by the account's master key.
 * False means we need to either bootstrap (first device) or verify with another device.
 */
export async function isDeviceTrusted(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");
  const status = await crypto.getDeviceVerificationStatus(client.getSafeUserId(), client.getDeviceId()!);
  return !!status?.crossSigningVerified;
}

/**
 * Generate fresh cross-signing keys and upload them.
 * Used during first-time setup (first device for this account).
 * Caller is responsible for collecting the user's account password if Synapse
 * demands UIAA (User-Interactive Authentication) — typically required for
 * uploading cross-signing keys.
 */
export async function bootstrapCrossSigning(
  client: MatrixClient,
  authCallback: (request: unknown) => Promise<unknown>,
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
      // Synapse will reject the upload and return a UIAA flow; the caller's
      // authCallback retries the request with the user's auth dictionary.
      await authCallback(makeRequest);
    },
    setupNewCrossSigning: true,
  });
}
```

- [ ] **Step 2: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
# Expected: success. matrix-js-sdk's types are subtle; if the build fails
# on `bootstrapCrossSigning` arg shape, consult the matrix-js-sdk v35 docs
# and adjust (the API surface drifts between minor versions).
```

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/matrix/crypto.ts
git commit -m "client: cross-signing bootstrap helpers"
```

---

## Task 15: Secret Storage (SSSS) + Recovery Key

**Files:**
- Modify: `client/src/renderer/matrix/crypto.ts` (add SSSS + Recovery Key)
- Create: `client/src/renderer/matrix/recoveryKey.ts`

- [ ] **Step 1: Write `client/src/renderer/matrix/recoveryKey.ts`**

```ts
/**
 * Format a raw key (32 bytes Uint8Array) into the human-readable Recovery Key
 * format Element uses: base58-encoded with spaces every 4 chars, e.g.,
 *   EsTL pTab GKDh 2DeP yMq8 jHj4 abc2
 */
export function formatRecoveryKey(raw: Uint8Array): string {
  // matrix-js-sdk exposes `encodeRecoveryKey` from "matrix-js-sdk/lib/crypto/recoverykey"
  // but the import path is internal and unstable. We do the encoding here.
  // For v1 we use Element's exact algorithm: 0x8B + 0x01 + 32 bytes + xor parity byte,
  // then base58 (matrix flavor).
  // For simplicity in v1 of Hailfreq we delegate to matrix-js-sdk's exposed helper:
  // (verify the exact import path at implementation time — matrix-js-sdk reorganizes these utilities frequently)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { encodeRecoveryKey } = require("matrix-js-sdk/lib/crypto/recoverykey");
  return encodeRecoveryKey(raw);
}

export function decodeRecoveryKey(formatted: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { decodeRecoveryKey } = require("matrix-js-sdk/lib/crypto/recoverykey");
  return decodeRecoveryKey(formatted);
}
```

**Implementer note:** matrix-js-sdk's recovery-key helpers move between versions. At implementation time, verify the import path and switch to whatever the v35 public API exposes (e.g., `crypto.encodeRecoveryKey()`). If no public API is exposed, vendor the small base58 + parity logic from Element's source — it's stable.

- [ ] **Step 2: Add SSSS bootstrap to `client/src/renderer/matrix/crypto.ts`**

Append:

```ts
/**
 * Generate a fresh Recovery Key and bootstrap SSSS (Secret Storage Service) with it.
 * Returns the formatted Recovery Key string for the user to save.
 *
 * Also seeds the key-backup machinery (see Task 16).
 */
export async function bootstrapSecretStorageWithNewKey(
  client: MatrixClient,
): Promise<{ recoveryKey: string }> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");

  // matrix-js-sdk generates the key, stores it as the SSSS default,
  // and encrypts the user's cross-signing master/self-signing/user-signing
  // private keys under it.
  const result = await crypto.bootstrapSecretStorage({
    createSecretStorageKey: async () => {
      // We let matrix-js-sdk pick the algorithm + entropy.
      return undefined as any;
    },
    setupNewSecretStorage: true,
  });

  // The Recovery Key is returned via the createSecretStorageKey callback
  // or via crypto.getSecretStorageBackupPrivateKey — exact API depends on
  // the matrix-js-sdk version. At implementation time, verify the v35 API
  // and either thread the key through `createSecretStorageKey` or fetch it
  // from the result object.

  // Placeholder — real implementation extracts the key from the bootstrap result:
  const keyId = await crypto.getDefaultSecretStorageKeyId();
  if (!keyId) throw new Error("Failed to generate Recovery Key");
  // The actual key bytes need to be returned from createSecretStorageKey;
  // see https://element-hq.github.io/element-web/develop/ for the reference.
  throw new Error("TODO: extract recovery key bytes from bootstrap result (see implementer note)");
}
```

**Implementer note (important):** the SSSS bootstrap API in matrix-js-sdk has changed shape across versions. The implementer should look at Element Web's `RestoreKeyBackupDialog.tsx` and `CreateSecretStorageDialog.tsx` for the current reference pattern. The key extraction typically happens *inside* the `createSecretStorageKey` callback (the SDK calls back with a freshly generated key for the app to display and persist). Wire it accordingly.

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
# Note: the build may pass even if the throw in bootstrapSecretStorageWithNewKey
# never runs. We exercise this in Task 16 + e2e tests.
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/matrix/crypto.ts client/src/renderer/matrix/recoveryKey.ts
git commit -m "client: secret storage bootstrap scaffold + recovery key helpers"
```

---

## Task 16: Encryption setup screen — display Recovery Key

**Files:**
- Create: `client/src/renderer/screens/EncryptionSetup.tsx`
- Modify: `client/src/renderer/AppState.tsx` (route to encryption setup after first-time login)

The screen flow: after a fresh login on the first device for this account, run cross-signing + SSSS bootstrap, then show the Recovery Key with a mandatory copy + checkbox confirmation before letting the user proceed to Home.

- [ ] **Step 1: Write `client/src/renderer/screens/EncryptionSetup.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";
import { bootstrapCrossSigning, bootstrapSecretStorageWithNewKey, hasCrossSigning } from "../matrix/crypto";

interface EncryptionSetupProps {
  client: MatrixClient;
  password: string | null; // Used for UIAA if available (local-login). null for OIDC users.
  onDone: () => void;
}

type State =
  | { kind: "checking" }
  | { kind: "needs-existing-recovery"; reason: "account-already-bootstrapped" }
  | { kind: "running" }
  | { kind: "showing-key"; recoveryKey: string }
  | { kind: "error"; error: string };

export function EncryptionSetup({ client, password, onDone }: EncryptionSetupProps) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // If account already has cross-signing keys uploaded by another device,
        // we shouldn't generate fresh ones — instead, route to the
        // "verify or restore from Recovery Key" flow (Task 17).
        if (await hasCrossSigning(client)) {
          setState({ kind: "needs-existing-recovery", reason: "account-already-bootstrapped" });
          return;
        }
        setState({ kind: "running" });
        await bootstrapCrossSigning(client, async (makeRequest) => {
          // UIAA: Synapse rejects the request and asks for password auth.
          // For OIDC users we'd need to launch a SSO flow; for now we require
          // local-account login as a precondition for first-time setup.
          if (!password) {
            throw new Error("CitizenID-only first-time setup is not yet supported in this build. Please use a local account or contact your guild admin.");
          }
          await makeRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: client.getSafeUserId() },
            password,
          });
        });
        const { recoveryKey } = await bootstrapSecretStorageWithNewKey(client);
        setState({ kind: "showing-key", recoveryKey });
      } catch (err) {
        setState({ kind: "error", error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [client, password]);

  switch (state.kind) {
    case "checking":
    case "running":
      return <Centered>Setting up encryption keys…</Centered>;
    case "needs-existing-recovery":
      return (
        <div className="mx-auto max-w-md p-6 text-sm text-slate-300">
          This account already has encryption keys set up on another device.
          You'll need to either verify this device from your other device, or
          enter your Recovery Key. (Wired in Task 17.)
        </div>
      );
    case "error":
      return <Centered>{state.error}</Centered>;
    case "showing-key":
      return (
        <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-6 p-6">
          <header>
            <h1 className="text-2xl font-semibold text-brand-400">Save your Recovery Key</h1>
            <p className="mt-2 text-sm text-slate-300">
              This key is the only way to recover encrypted messages if you lose
              all your signed-in devices. Save it in a password manager or
              somewhere offline. <strong>Hailfreq does not store this key</strong> —
              there is no way to recover it later.
            </p>
          </header>
          <div className="rounded border border-slate-700 bg-slate-800 p-4">
            <code className="block break-all font-mono text-base text-brand-50">
              {state.recoveryKey}
            </code>
            <Button
              variant="ghost"
              className="mt-3 text-xs"
              onClick={() => navigator.clipboard.writeText(state.recoveryKey)}
            >
              Copy to clipboard
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have saved my Recovery Key somewhere safe
          </label>
          <Button onClick={onDone} disabled={!confirmed}>
            Continue to Hailfreq
          </Button>
        </div>
      );
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 2: Modify `AppState.tsx`** — add `encryption-setup` state and route there after login

Add to the `Screen` union:

```tsx
| { kind: "encryption-setup"; client: MatrixClient; password: string | null; creds: Credentials };
```

Inside the login `onLoggedIn`, instead of going directly to `home`, start the client and check whether encryption setup is needed. (For now, all freshly-logged-in users go to encryption setup. Task 17 handles the "already bootstrapped, needs verification" case.) The transition:

```tsx
onLoggedIn={async (creds) => {
  const { startClient } = await import("./matrix/client");
  const handle = await startClient(creds);
  // For local-login we kept the password in component state to satisfy UIAA;
  // pull it from the Login screen via an extended onLoggedIn signature.
  // (Implementer: thread the password through onLoggedIn(creds, password) — see note below.)
  setScreen({ kind: "encryption-setup", client: handle.client, password: lastPassword, creds });
}}
```

**Implementer note:** the `password` thread-through from Login to EncryptionSetup is a small API change to Login's `onLoggedIn` callback. Either widen its signature to `(creds, password) => void`, or pass the password via the React context. Pick whichever feels less intrusive in your codebase. UIAA without the password is a non-goal for v1 — the simplest path is to require local-login for first-time setup.

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/screens/EncryptionSetup.tsx client/src/renderer/AppState.tsx
git commit -m "client: encryption setup screen with Recovery Key display"
```

---

## Task 17: Key backup + restore from Recovery Key

**Files:**
- Modify: `client/src/renderer/matrix/crypto.ts` (add key backup creation + restore-by-key)
- Create: `client/src/renderer/screens/RestoreFromRecoveryKey.tsx`
- Modify: `client/src/renderer/AppState.tsx` (route here when account is already bootstrapped)

- [ ] **Step 1: Extend `client/src/renderer/matrix/crypto.ts`** with key backup helpers

```ts
/**
 * Create a new Megolm key backup version on the homeserver.
 * Run once during first-time setup, after SSSS bootstrap.
 */
export async function createKeyBackup(client: MatrixClient): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");
  await crypto.resetKeyBackup();
}

/**
 * Restore decryption keys from the server-side encrypted backup, using the user's
 * Recovery Key. Used when logging into a new device.
 */
export async function restoreFromRecoveryKey(
  client: MatrixClient,
  recoveryKey: string,
): Promise<{ imported: number }> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Crypto not initialized");
  // matrix-js-sdk's exact API here varies across versions. The typical sequence is:
  //   1. crypto.bootstrapSecretStorage with a function that returns the decoded key
  //   2. crypto.checkOwnCrossSigningTrust() to fetch and decrypt cross-signing keys from SSSS
  //   3. crypto.restoreKeyBackupWithSecretStorage() to pull Megolm sessions from key backup
  // Implementer: follow Element Web's RestoreKeyBackupDialog pattern.
  // For v1, encapsulate it here so the screen has one function to call.

  // (Implementer note: the call below will need adjustment to match matrix-js-sdk v35's
  // public API. The intent is correct; the exact method names may differ.)
  throw new Error("TODO: implement using matrix-js-sdk v35 SSSS+backup restore API");
}
```

- [ ] **Step 2: Write `client/src/renderer/screens/RestoreFromRecoveryKey.tsx`**

```tsx
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { restoreFromRecoveryKey } from "../matrix/crypto";

interface RestoreProps {
  client: MatrixClient;
  onRestored: () => void;
}

export function RestoreFromRecoveryKey({ client, onRestored }: RestoreProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await restoreFromRecoveryKey(client, key.trim());
      console.log(`Restored ${result.imported} encrypted messages from backup`);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">Verify this device</h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter your Recovery Key to unlock encrypted history on this device.
          You can also verify by approving from another signed-in device.
        </p>
      </header>
      <Input
        label="Recovery Key"
        placeholder="EsTL pTab GKDh 2DeP yMq8 jHj4 abc2"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoFocus
        required
        error={error || undefined}
      />
      <Button type="submit" disabled={!key.trim() || busy}>
        {busy ? "Restoring…" : "Verify"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Modify `AppState.tsx`** — route to restore screen when account is already bootstrapped

When `EncryptionSetup` reports `kind: "needs-existing-recovery"`, transition the AppState into a new `restore-from-recovery` screen kind that renders `RestoreFromRecoveryKey`. Adjust the state machine accordingly. On `onRestored`, transition to `home`.

- [ ] **Step 4: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/matrix/crypto.ts client/src/renderer/screens/RestoreFromRecoveryKey.tsx client/src/renderer/AppState.tsx
git commit -m "client: restore-from-recovery-key flow for new devices"
```

---

## Task 18: SAS device verification UI

**Files:**
- Create: `client/src/renderer/matrix/verification.ts`
- Create: `client/src/renderer/components/EmojiVerification.tsx`
- Modify: `client/src/renderer/AppState.tsx` (subscribe to incoming verification requests)

SAS verification: when another device for the same account starts a verification with this device, we get a `m.key.verification.request` event. UI: show 7 emoji from the verifier and ask user to confirm they match. After confirming, mutual cross-signing trust is established without needing the Recovery Key.

- [ ] **Step 1: Write `client/src/renderer/matrix/verification.ts`**

```ts
import type { MatrixClient, VerificationRequest } from "matrix-js-sdk";

export interface IncomingVerification {
  request: VerificationRequest;
  cancel(): Promise<void>;
}

/**
 * Subscribe to incoming verification requests. Calls onIncoming when a new
 * request arrives. Returns an unsubscribe function.
 */
export function subscribeToVerificationRequests(
  client: MatrixClient,
  onIncoming: (v: IncomingVerification) => void,
): () => void {
  const handler = (request: VerificationRequest) => {
    if (request.initiatedByMe) return;
    onIncoming({
      request,
      cancel: () => request.cancel(),
    });
  };

  client.on("crypto.verification.request" as any, handler);
  return () => client.off("crypto.verification.request" as any, handler);
}
```

- [ ] **Step 2: Write `client/src/renderer/components/EmojiVerification.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { VerificationRequest, ShowSasCallbacks } from "matrix-js-sdk";
import { Button } from "./Button";

interface Props {
  request: VerificationRequest;
  onDone: (verified: boolean) => void;
}

interface Emoji {
  symbol: string;
  description: string;
}

export function EmojiVerification({ request, onDone }: Props) {
  const [emojis, setEmojis] = useState<Emoji[] | null>(null);
  const [sasCb, setSasCb] = useState<ShowSasCallbacks | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const verifier = request.beginKeyVerification("m.sas.v1");
      verifier.on("show_sas" as any, (cb: ShowSasCallbacks) => {
        if (cancelled) return;
        setSasCb(cb);
        // SAS emoji are reported on the callback; matrix-js-sdk v35 surfaces them
        // either as `cb.sas.emoji` (array of [symbol, description] tuples) or via
        // a related getter. Verify at impl time.
        const tuples: [string, string][] = (cb as any).sas?.emoji ?? [];
        setEmojis(tuples.map(([symbol, description]) => ({ symbol, description })));
      });
      await verifier.verify();
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!emojis || !sasCb) {
    return <p className="p-6 text-sm text-slate-400">Starting verification…</p>;
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <h2 className="text-lg font-semibold text-brand-400">Compare these emoji</h2>
      <p className="mt-1 text-sm text-slate-400">
        They should match exactly on your other device.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-3">
        {emojis.map((e, i) => (
          <div key={i} className="flex flex-col items-center rounded border border-slate-700 bg-slate-800 p-3">
            <span className="text-3xl">{e.symbol}</span>
            <span className="mt-1 text-xs text-slate-400">{e.description}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-3">
        <Button onClick={() => { sasCb.confirm(); onDone(true); }}>
          They match
        </Button>
        <Button variant="ghost" onClick={() => { sasCb.mismatch(); onDone(false); }}>
          They don't match
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Subscribe in `AppState.tsx`**

When in the `home` state, set up a useEffect that subscribes to verification requests and shows a modal/overlay containing `EmojiVerification` when one arrives. (Modal implementation: a simple fixed-position div over the home shell. Skip if the home shell is a placeholder; just render the EmojiVerification full-screen instead.)

- [ ] **Step 4: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/matrix/verification.ts client/src/renderer/components/EmojiVerification.tsx client/src/renderer/AppState.tsx
git commit -m "client: SAS emoji verification UI for cross-device trust"
```

---

## Task 19: Logout flow

**Files:**
- Create: `client/src/renderer/screens/Home.tsx` (placeholder with logout button)
- Modify: `client/src/renderer/AppState.tsx` (wire logout transition)

For Plan 2, Home is a placeholder — just enough UI to prove login worked and let the user log out cleanly. The actual room list / tactical-radio UI comes in later plans.

- [ ] **Step 1: Write `client/src/renderer/screens/Home.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";

interface HomeProps {
  client: MatrixClient;
  onLogout: () => Promise<void>;
}

export function Home({ client, onLogout }: HomeProps) {
  const [roomCount, setRoomCount] = useState(0);

  useEffect(() => {
    const update = () => setRoomCount(client.getRooms().length);
    update();
    client.on("sync" as any, update);
    return () => { client.off("sync" as any, update); };
  }, [client]);

  return (
    <div className="flex h-full flex-col p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-400">Hailfreq</h1>
          <p className="mt-1 text-xs text-slate-500">
            Signed in as {client.getSafeUserId()} · {roomCount} rooms
          </p>
        </div>
        <Button variant="ghost" onClick={onLogout}>Log out</Button>
      </header>
      <div className="mt-12 text-center text-sm text-slate-400">
        <p>Tactical-radio features coming in Plan 4.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire logout in `AppState.tsx`**

Add a `home` case rendering `<Home client={...} onLogout={...} />`. The `onLogout` callback:

```tsx
async function handleLogout(handle: ClientHandle) {
  await handle.shutdown();
  await window.hailfreq.invoke("tokens:clear");
  await window.hailfreq.invoke("settings:set", { userId: "", lastLoginMethod: "" });
  setScreen({ kind: "login", serverUrl: handle.client.getHomeserverUrl() });
}
```

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/screens/Home.tsx client/src/renderer/AppState.tsx
git commit -m "client: placeholder home shell with logout flow"
```

---

## Task 20: Vitest unit tests for critical utilities

**Files:**
- Create: `client/vitest.config.ts`
- Create: `client/tests/unit/firstrun.test.ts`
- Create: `client/tests/unit/recoveryKey.test.ts`
- Create: `client/tests/unit/tokens.test.ts`

- [ ] **Step 1: Write `client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
```

- [ ] **Step 2: Write `client/tests/unit/firstrun.test.ts`**

The FirstRun screen has a pure `normalizeUrl` function worth unit-testing. Extract it into `src/renderer/screens/firstRunUtils.ts` first (so it's importable without React), then write the test:

In `src/renderer/screens/firstRunUtils.ts`:

```ts
export function normalizeUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}
```

Update `FirstRun.tsx` to import from this file instead of defining inline.

Then `tests/unit/firstrun.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUrl } from "@/renderer/screens/firstRunUtils";

describe("normalizeUrl", () => {
  it("adds https:// when scheme is missing", () => {
    expect(normalizeUrl("radio.example.com")).toBe("https://radio.example.com");
  });
  it("preserves http:// when explicit", () => {
    expect(normalizeUrl("http://radio.example.com")).toBe("http://radio.example.com");
  });
  it("strips trailing slashes", () => {
    expect(normalizeUrl("radio.example.com/")).toBe("https://radio.example.com");
    expect(normalizeUrl("https://radio.example.com///")).toBe("https://radio.example.com");
  });
  it("trims whitespace", () => {
    expect(normalizeUrl("  radio.example.com  ")).toBe("https://radio.example.com");
  });
});
```

- [ ] **Step 3: Write `client/tests/unit/recoveryKey.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatRecoveryKey, decodeRecoveryKey } from "@/renderer/matrix/recoveryKey";

describe("recoveryKey", () => {
  it("round-trips raw → formatted → raw", () => {
    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) raw[i] = i;
    const formatted = formatRecoveryKey(raw);
    expect(formatted).toMatch(/^[A-Za-z0-9]+( [A-Za-z0-9]+)+$/);
    const back = decodeRecoveryKey(formatted);
    expect(Array.from(back)).toEqual(Array.from(raw));
  });
});
```

- [ ] **Step 4: Skip `tokens.test.ts` for now**

`tokens.ts` depends on Electron's `safeStorage` which can't be tested without an Electron runtime. Defer to the Playwright E2E suite (Task 22).

- [ ] **Step 5: Run unit tests**

```bash
cd client
npx vitest run
# Expected: all tests pass
```

- [ ] **Step 6: Commit**

```bash
git add client/vitest.config.ts client/tests/unit/ client/src/renderer/screens/firstRunUtils.ts client/src/renderer/screens/FirstRun.tsx
git commit -m "client: vitest unit tests for url normalization and recovery key round-trip"
```

---

## Task 21: Linux AppImage build

**Files:**
- Create: `client/electron-builder.yml`
- Create: `client/assets/icon.png` (placeholder — substitute real icon when available)

- [ ] **Step 1: Generate a placeholder icon**

```bash
cd client
# Use ImageMagick to make a 512x512 placeholder. If unavailable, drop in any 512x512 PNG.
convert -size 512x512 xc:'#0891b2' -fill '#22d3ee' -gravity center -pointsize 200 -annotate +0+0 'H' assets/icon.png 2>&1 || \
  echo "ImageMagick missing — create assets/icon.png manually (512x512 PNG)"
ls -l assets/icon.png
```

- [ ] **Step 2: Write `client/electron-builder.yml`**

```yaml
appId: org.hailfreq.client
productName: Hailfreq
artifactName: Hailfreq-${version}-${arch}.${ext}
directories:
  output: release
files:
  - dist/**/*
  - dist-electron/**/*
  - package.json
  - "!**/*.map"
  - "!**/*.d.ts"
  - "!**/tsconfig*.json"

linux:
  target:
    - AppImage
  category: Network
  icon: assets/icon.png
  synopsis: Privacy-first Matrix desktop client for tactical voice ops
  description: Hailfreq is a desktop Matrix client built for game communities that need tactical-radio multi-net voice with end-to-end encryption.

win:
  target:
    - target: nsis
      arch:
        - x64
  icon: assets/icon.png

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 3: Build Linux AppImage**

```bash
cd client
npm run build
npm run dist:linux 2>&1 | tail -20
# Expected: release/Hailfreq-0.1.0-x86_64.AppImage exists
ls -lh release/
```

- [ ] **Step 4: Smoke test the AppImage starts**

```bash
chmod +x release/Hailfreq-*.AppImage
timeout 5 ./release/Hailfreq-*.AppImage 2>&1 | head -10 || true
# Expected: process starts; we kill after 5s. Look for Electron startup messages, no immediate crash.
```

- [ ] **Step 5: Commit**

```bash
git add client/electron-builder.yml client/assets/
git commit -m "client: electron-builder config for Linux AppImage"
```

---

## Task 22: Playwright E2E — full first-run + login flow

**Files:**
- Create: `client/playwright.config.ts`
- Create: `client/tests/e2e/firstrun.spec.ts`
- Create: `client/tests/e2e/helpers/synapse.ts`

The E2E test spins up Plan 1's server kit (Synapse + postgres), launches the built Electron app via Playwright's Electron driver, walks through first-run + local-account login + encryption setup + Recovery Key display, then verifies the Home screen appears.

- [ ] **Step 1: Write `client/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false, // We run one Electron process at a time
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
```

- [ ] **Step 2: Write `client/tests/e2e/helpers/synapse.ts`**

```ts
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SERVER_DIR = path.resolve(__dirname, "../../../../../server");

/**
 * Stand up Plan 1's server stack on localhost:8008 with port-publish.
 * Returns the Synapse URL and a cleanup function.
 */
export async function startSynapse(): Promise<{ url: string; cleanup: () => Promise<void> }> {
  // Render configs (idempotent)
  execSync("./scripts/setup.sh localhost.test admin@localhost.test", { cwd: SERVER_DIR, stdio: "inherit" });
  // Force a known PUBLIC_IP for local testing
  const envFile = path.join(SERVER_DIR, ".env");
  fs.writeFileSync(envFile, fs.readFileSync(envFile, "utf8").replace(/HAILFREQ_PUBLIC_IP=.*/, "HAILFREQ_PUBLIC_IP=127.0.0.1"));
  execSync("./scripts/setup.sh", { cwd: SERVER_DIR, stdio: "inherit" });

  // Override file to publish port 8008
  fs.writeFileSync(path.join(SERVER_DIR, "compose.override.yml"), `services:\n  synapse:\n    ports:\n      - "8008:8008"\n`);

  execSync("podman compose up -d postgres synapse", { cwd: SERVER_DIR, stdio: "inherit" });

  // Wait up to 90s for /health
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch("http://localhost:8008/health");
      if (r.ok) break;
    } catch {}
    await sleep(1000);
  }

  // Provision a test user via admin API (HMAC-SHA1)
  const sharedSecret = readEnv(envFile, "SYNAPSE_REGISTRATION_SHARED_SECRET");
  const username = `e2e_${crypto.randomBytes(4).toString("hex")}`;
  const password = crypto.randomBytes(12).toString("base64url");
  const nonce = (await (await fetch("http://localhost:8008/_synapse/admin/v1/register")).json()).nonce;
  const mac = crypto.createHmac("sha1", sharedSecret);
  for (const p of [nonce, "\x00", username, "\x00", password, "\x00", "notadmin"]) mac.update(p);
  await fetch("http://localhost:8008/_synapse/admin/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, username, password, admin: false, mac: mac.digest("hex") }),
  });

  return {
    url: "http://localhost:8008",
    cleanup: async () => {
      execSync("podman compose down -v", { cwd: SERVER_DIR, stdio: "inherit" });
      fs.rmSync(path.join(SERVER_DIR, "compose.override.yml"), { force: true });
    },
  };
}

function readEnv(file: string, key: string): string {
  const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`${key} not in env`);
  return m[1];
}

export function provisionUser(serverUrl: string, sharedSecret: string): Promise<{ username: string; password: string }> {
  const username = `e2e_${crypto.randomBytes(4).toString("hex")}`;
  const password = crypto.randomBytes(12).toString("base64url");
  return (async () => {
    const nonce = (await (await fetch(`${serverUrl}/_synapse/admin/v1/register`)).json()).nonce;
    const mac = crypto.createHmac("sha1", sharedSecret);
    for (const p of [nonce, "\x00", username, "\x00", password, "\x00", "notadmin"]) mac.update(p);
    await fetch(`${serverUrl}/_synapse/admin/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, username, password, admin: false, mac: mac.digest("hex") }),
    });
    return { username, password };
  })();
}
```

- [ ] **Step 3: Write `client/tests/e2e/firstrun.spec.ts`**

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { startSynapse } from "./helpers/synapse";

test("first-run → local login → encryption setup → home", async () => {
  const { url, cleanup } = await startSynapse();
  try {
    const app = await electron.launch({ args: ["."], cwd: ".." });
    const win = await app.firstWindow();

    // First-run screen
    await expect(win.getByText("Welcome to Hailfreq")).toBeVisible();
    await win.getByLabel("Server URL").fill(url);
    await win.getByRole("button", { name: "Continue" }).click();

    // Login screen — fill in the credentials we provisioned via admin API
    // (The helper attaches them to a global; in a real test you'd thread them
    // through the test fixture properly. This sketch leaves that as a TODO.)
    // ...
    // await win.getByLabel("Username").fill(username);
    // await win.getByLabel("Password").fill(password);
    // await win.getByRole("button", { name: "Sign in" }).click();

    // Encryption setup → Recovery Key screen
    // await expect(win.getByText("Save your Recovery Key")).toBeVisible({ timeout: 30_000 });
    // await win.getByLabel("I have saved my Recovery Key somewhere safe").check();
    // await win.getByRole("button", { name: "Continue to Hailfreq" }).click();

    // Home shell
    // await expect(win.getByText(/Signed in as/)).toBeVisible();

    await app.close();
  } finally {
    await cleanup();
  }
});
```

**Implementer note:** the test above intentionally leaves the credential threading to the implementer to flesh out — the structure of the test, the Playwright Electron driver setup, and the startSynapse helper are the load-bearing pieces. Wire the credentials through a test fixture that creates the user *before* launching the Electron app.

- [ ] **Step 4: Install Playwright browsers (needed even for Electron driver)**

```bash
cd client
npx playwright install --with-deps chromium
```

- [ ] **Step 5: Run E2E**

```bash
cd client
npm run build
npx playwright test 2>&1 | tail -20
# Expected: at least the first-run + login portion completes. Encryption setup
# may require the matrix-js-sdk crypto API tweaks from Tasks 15-17 to be fully
# implemented; mark the test as `.skip` for the encryption section if it's not
# yet working, but verify the first-run + login portion passes.
```

- [ ] **Step 6: Commit**

```bash
git add client/playwright.config.ts client/tests/e2e/
git commit -m "client: playwright e2e harness with synapse fixture"
```

---

## Task 23: Build documentation

**Files:**
- Create: `client/docs/build.md`
- Create: `client/docs/development.md`

- [ ] **Step 1: Write `client/docs/build.md`**

```markdown
# Building Hailfreq

## Prerequisites

- Node.js 20+ and npm
- For Linux builds: native build tools (`build-essential` on Debian/Ubuntu, `base-devel` on Arch)
- For Windows cross-builds from Linux: `wine` (best effort; native Windows is more reliable)

## Quick start

```bash
npm ci
npm run build
npm run dist:linux       # produces release/Hailfreq-*.AppImage
npm run dist:windows     # produces release/Hailfreq-*.exe (nsis)
```

## Outputs

- **Linux:** `release/Hailfreq-<version>-x86_64.AppImage` — single-file portable executable
- **Windows:** `release/Hailfreq-<version>-x64.exe` — nsis installer

## Code signing

Not yet wired up. To sign Windows builds, set `CSC_LINK` and `CSC_KEY_PASSWORD` env vars per electron-builder docs.
Linux AppImages are not commonly signed; AppImageHub will SHA-256 manifest them on upload.
```

- [ ] **Step 2: Write `client/docs/development.md`**

```markdown
# Hailfreq Client — Development

## Setup

```bash
npm ci
npm run dev           # Vite dev server + Electron with HMR
npm run test:unit     # Vitest unit tests
npm run test:e2e      # Playwright E2E (requires Plan 1 server stack)
npm run lint          # TypeScript strict-check (no emit)
```

## Layout

- `src/main/` — Electron main process (Node.js)
- `src/preload/` — Bridge between main and renderer
- `src/renderer/` — React UI (browser context with contextIsolation)
- `src/shared/` — Types shared between main and renderer
- `tests/unit/` — Pure-TS unit tests (no Electron runtime)
- `tests/e2e/` — Playwright tests driving the built app against a live Synapse

## E2E prerequisites

The E2E suite spins up Plan 1's server (`server/` in the repo root). You'll need:

- `podman` + `podman-compose` (or `docker compose`)
- The first-time rootless-podman uid 991 ownership fix may be required — see `server/docs/troubleshooting.md`

## Adding a new IPC channel

1. Add the channel definition to `src/shared/ipc.ts`
2. Implement the handler in `src/main/ipc.ts`
3. Call from renderer via `window.hailfreq.invoke("channel-name", ...args)`

Type safety flows end-to-end — the renderer call site won't compile if the channel doesn't exist or args don't match.

## matrix-js-sdk caveats

The crypto API surface has changed across recent matrix-js-sdk versions. If a method signature in `src/renderer/matrix/crypto.ts` doesn't match what your installed version exposes, check Element Web's source (https://github.com/element-hq/element-web) for the current reference patterns — they upgrade matrix-js-sdk frequently and their dialogs are the canonical examples.
```

- [ ] **Step 3: Commit**

```bash
git add client/docs/
git commit -m "docs(client): build and development guides"
```

---

## Task 24: Windows nsis build

**Files:**
- Verify: `client/electron-builder.yml` already has the `win` block
- Create: `client/docs/windows-build.md`

- [ ] **Step 1: Attempt Windows cross-build from Linux**

```bash
cd client
npm run dist:windows 2>&1 | tail -20
# Expected: either succeeds and produces release/Hailfreq-*.exe, OR fails with
# a message about needing wine. Capture the result.
```

- [ ] **Step 2: Write `client/docs/windows-build.md`**

```markdown
# Building the Windows installer

## Native (recommended)

On a Windows machine with Node.js 20+:

```cmd
git clone https://github.com/your-org/tactical-radio.git
cd tactical-radio\client
npm ci
npm run build
npm run dist:windows
```

Output: `release\Hailfreq-<version>-x64.exe`

## Cross-compile from Linux

Requires `wine` (best effort — some electron-builder features may not work). Install on Fedora/Nobara:

```bash
sudo dnf install wine
```

On Debian/Ubuntu:

```bash
sudo apt-get install wine
```

Then:

```bash
npm run dist:windows
```

If you hit `Error: Cannot find module 'app-builder-bin/win/x64/app-builder.exe'` or similar, the cross-build environment isn't fully set up. Native Windows build is more reliable.

## Code signing

To sign, set environment variables before the build:

```bash
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD='your password'
npm run dist:windows
```

See electron-builder code-signing docs: https://www.electron.build/code-signing
```

- [ ] **Step 3: Commit**

```bash
git add client/docs/windows-build.md
git commit -m "docs(client): windows build guide and cross-compile notes"
```

---

## Task 25: Top-level README + ship summary

**Files:**
- Modify: `client/README.md` (point at the docs folder)

- [ ] **Step 1: Rewrite `client/README.md`**

```markdown
# Hailfreq Client

Privacy-first Matrix desktop client. Electron + React + TypeScript. Windows + Linux.

After Plan 2, this client supports:

- First-run server URL configuration
- Login via CitizenID OIDC or local Synapse accounts
- Full Matrix end-to-end encryption setup (cross-signing + key backup + Recovery Key)
- SAS device verification with another signed-in device
- Auto-resume on relaunch
- Logout flow

Tactical-radio voice features (multi-net monitor, PTT, priority ducking, admin board) arrive in Plans 4 and beyond.

## Quick start

```bash
npm ci
npm run dev          # development with HMR
npm run test:unit    # vitest unit tests
npm run test:e2e     # playwright e2e (requires Plan 1 server)
npm run dist:linux   # AppImage
npm run dist:windows # nsis installer
```

See:

- [`docs/build.md`](docs/build.md) — building installers
- [`docs/development.md`](docs/development.md) — dev environment + adding IPC channels
- [`docs/windows-build.md`](docs/windows-build.md) — Windows-specific build notes
```

- [ ] **Step 2: Commit**

```bash
git add client/README.md
git commit -m "docs(client): top-level README pointing at build/dev docs"
```

---

## Done

After Task 25, the deliverable is:

- A `client/` directory containing a working Hailfreq Electron app for Windows + Linux
- Auth via CitizenID OIDC and local Synapse accounts
- Full Matrix E2E encryption setup with Recovery Key
- SAS device verification
- A placeholder Home screen (real UI arrives in Plan 4+)
- Vitest unit tests + Playwright E2E suite
- Build pipeline + documentation

**Next plans:**

- **Plan 3:** Multi-server sidebar (Discord-style server switcher)
- **Plan 4:** Multi-net voice engine (the headline tactical-radio feature)
- **Plan 5:** Admin / Squad-Leader board
