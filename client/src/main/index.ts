import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  registerIpcHandlers();
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
    const isDev = !app.isPackaged;
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    const allowed =
      (isDev && !!devUrl && url.startsWith(devUrl))
      || url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
