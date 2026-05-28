import Store from "electron-store";
import type { Settings } from "../shared/types";

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
