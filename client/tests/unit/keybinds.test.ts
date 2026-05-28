import { describe, it, expect } from "vitest";
import { eventToAccelerator } from "@/renderer/voice/keybinds";

function ev(opts: Partial<KeyboardEvent>): KeyboardEvent {
  const event = {
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...opts,
  } as KeyboardEvent;
  return event;
}

describe("eventToAccelerator", () => {
  it("returns a function-key code", () => {
    expect(eventToAccelerator(ev({ code: "F13" }))).toBe("F13");
  });
  it("formats modifier keys in canonical order", () => {
    expect(eventToAccelerator(ev({ code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Control+Shift+P");
  });
  it("normalizes Digit codes", () => {
    expect(eventToAccelerator(ev({ code: "Digit5", altKey: true }))).toBe("Alt+5");
  });
  it("returns null for modifier-only presses", () => {
    expect(eventToAccelerator(ev({ code: "ShiftLeft" }))).toBeNull();
  });
});
