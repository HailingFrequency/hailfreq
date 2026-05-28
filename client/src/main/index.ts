import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";
import { settings } from "./store";
import { migrateLegacyCredentials } from "./tokens";
import { unregisterAllHolds } from "./nativeKeyListener";
import { createTray, markQuitting, shouldQuitOnClose } from "./tray";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  registerIpcHandlers();
  // If migration just ran (single server with no token file yet), move the legacy token
  const servers = settings.get("servers");
  if (servers.length === 1) {
    await migrateLegacyCredentials(servers[0].id);
  }
  mainWindow = createMainWindow();

  // System tray: create after window is ready
  createTray(() => mainWindow);

  // Hide to tray on close instead of quitting (except when user explicitly quits)
  mainWindow.on("close", (event) => {
    if (!shouldQuitOnClose()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  app.on("activate", () => {
    // macOS: re-create window if dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      createTray(() => mainWindow);
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Mark quitting before the app exits so the close handler allows it
app.on("before-quit", () => {
  markQuitting();
});

// On macOS, keep the app alive in the tray when all windows are closed.
// On Linux/Windows, do NOT quit here — the tray keeps the app alive.
// The user must use the tray "Quit" item or before-quit will handle cleanup.
app.on("window-all-closed", () => {
  // Do nothing: tray keeps the app alive on all platforms.
  // On macOS, the conventional behavior (quit when last window closes unless
  // dock icon / tray is present) is also suppressed here — tray is the exit point.
});

app.on("will-quit", () => {
  unregisterAllHolds();
});

// Prevent navigation to arbitrary URLs (defense in depth)
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const isDev = !app.isPackaged;
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    const allowed =
      (isDev && !!devUrl && url.startsWith(devUrl))
      || url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
