import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";
import { settings } from "./store";
import { migrateLegacyCredentials } from "./tokens";
import { unregisterAllHolds } from "./nativeKeyListener";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  registerIpcHandlers();
  // If migration just ran (single server with no token file yet), move the legacy token
  const servers = settings.get("servers");
  if (servers.length === 1) {
    await migrateLegacyCredentials(servers[0].id);
  }
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
