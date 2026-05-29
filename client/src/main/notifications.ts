import { Notification, BrowserWindow } from "electron";

export interface NotifyOptions {
  title: string;
  body: string;
  /** Server ID to switch to when the notification is clicked. */
  serverId?: string;
}

/**
 * Show a native OS desktop notification.
 * On click: bring the main window to front and send `notify:clicked` to the renderer
 * so AppState can switch to the relevant server.
 */
export function showNotification(
  opts: NotifyOptions,
  getMainWindow: () => BrowserWindow | null,
): void {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: opts.title,
    body: opts.body,
    silent: false,
  });

  n.on("click", () => {
    const win = getMainWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
    if (opts.serverId) {
      win.webContents.send("notify:clicked", { serverId: opts.serverId });
    }
  });

  n.show();
}
