import { describe, it, expect } from "vitest";
import { shouldGatePass, type FocusGateInput } from "@/renderer/voice/focusGate";

const baseFocus = { processName: null as string | null, title: null as string | null, isWayland: false };

function input(overrides: Partial<FocusGateInput["focus"]> & Partial<Pick<FocusGateInput, "allowlist">>): FocusGateInput {
  const { allowlist, ...focusOverrides } = overrides;
  return {
    focus: { ...baseFocus, ...focusOverrides },
    allowlist: allowlist ?? [],
  };
}

describe("shouldGatePass", () => {
  it("passes (fail-open) on Wayland regardless of allowlist", () => {
    expect(shouldGatePass(input({ isWayland: true, allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("passes (fail-open) when focus probe has no data", () => {
    expect(shouldGatePass(input({ processName: null, title: null, allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("passes when allowlist is empty (gate effectively disabled)", () => {
    expect(shouldGatePass(input({ processName: "FirefoxNightly.exe", allowlist: [] }))).toBe(true);
  });

  it("passes when process name contains an allowlist entry (case-insensitive)", () => {
    expect(shouldGatePass(input({ processName: "StarCitizen.exe", allowlist: ["starcitizen"] }))).toBe(true);
  });

  it("passes when window title contains an allowlist entry (case-insensitive)", () => {
    expect(shouldGatePass(input({ processName: "wine64-preloader", title: "Star Citizen", allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("blocks when neither process name nor title matches any allowlist entry", () => {
    expect(shouldGatePass(input({ processName: "firefox.exe", title: "Inbox", allowlist: ["StarCitizen"] }))).toBe(false);
  });

  it("passes when any single allowlist entry matches", () => {
    expect(
      shouldGatePass(
        input({ processName: "elementx.exe", allowlist: ["StarCitizen", "ElementX"] }),
      ),
    ).toBe(true);
  });

  it("ignores empty allowlist entries when matching", () => {
    expect(shouldGatePass(input({ processName: "firefox.exe", allowlist: ["", "  "] }))).toBe(false);
  });
});
