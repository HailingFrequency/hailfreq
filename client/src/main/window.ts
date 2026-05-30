import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
      // M1: sandbox enabled. The preload is now built as CJS (index.cjs) and only
      // requires `electron`, which a sandboxed preload supports. This adds
      // Chromium's OS-level renderer sandbox on top of contextIsolation.
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  // Open DevTools in dev mode unless running under E2E tests (HAILFREQ_TEST=1)
  if (isDev && !process.env.HAILFREQ_TEST) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}
