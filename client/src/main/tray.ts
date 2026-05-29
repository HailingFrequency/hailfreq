import { Tray, Menu, BrowserWindow, nativeImage, app } from "electron";
import path from "node:path";

let tray: Tray | null = null;
let isQuitting = false;

export function markQuitting(): void {
  isQuitting = true;
}

export function shouldQuitOnClose(): boolean {
  return isQuitting;
}

export function createTray(getMainWindow: () => BrowserWindow | null): void {
  const iconPath = path.join(app.getAppPath(), "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Hailfreq");

  const buildMenu = () => {
    const win = getMainWindow();
    const isVisible = win?.isVisible() ?? false;
    return Menu.buildFromTemplate([
      {
        label: isVisible ? "Hide Hailfreq" : "Show Hailfreq",
        click: () => {
          const w = getMainWindow();
          if (!w) return;
          if (w.isVisible()) {
            w.hide();
          } else {
            w.show();
            w.focus();
          }
          // Rebuild menu to reflect new visibility state
          tray?.setContextMenu(buildMenu());
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
  };

  tray.setContextMenu(buildMenu());

  // Left-click: toggle window visibility (Linux/Windows; macOS uses right-click)
  tray.on("click", () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isVisible()) {
      w.hide();
    } else {
      w.show();
      w.focus();
    }
    // Rebuild context menu to keep Show/Hide label in sync
    tray?.setContextMenu(buildMenu());
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
