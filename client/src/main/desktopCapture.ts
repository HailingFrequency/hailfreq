import { desktopCapturer } from "electron";
import type { DesktopCaptureSource } from "../shared/ipc";

export async function listSources(): Promise<DesktopCaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    kind: s.id.startsWith("screen:") ? "screen" : "window",
  }));
}
