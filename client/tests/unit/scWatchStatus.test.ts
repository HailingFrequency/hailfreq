import { describe, it, expect } from "vitest";
import { deriveScWatchStatus, formatActivity } from "@/renderer/sc/watchStatus";

describe("deriveScWatchStatus", () => {
  it("returns 'unset' when no path is configured", () => {
    expect(deriveScWatchStatus({ scInstallPath: undefined, enabledServerNames: [], watching: false })).toBe("unset");
    expect(deriveScWatchStatus({ scInstallPath: "", enabledServerNames: ["A"], watching: true })).toBe("unset");
  });

  it("returns 'disabled' when a path is set but no server has Ship Link enabled", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: [], watching: false })).toBe("disabled");
  });

  it("returns 'watching' when path set, a server is enabled, and the tailer is active", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: ["A"], watching: true })).toBe("watching");
  });

  it("returns 'not-watching' when path set + enabled but tailer is not active (file missing)", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: ["A"], watching: false })).toBe("not-watching");
  });
});

describe("formatActivity", () => {
  it("reports no activity when lastLineAt is null", () => {
    expect(formatActivity(null, 1000)).toBe("no activity yet");
  });
  it("reports 'just now' under one second", () => {
    expect(formatActivity(1000, 1400)).toBe("just now");
  });
  it("reports seconds", () => {
    expect(formatActivity(1000, 4000)).toBe("3s ago");
  });
  it("reports minutes", () => {
    expect(formatActivity(0, 120_000)).toBe("2m ago");
  });
  it("reports hours", () => {
    expect(formatActivity(0, 7_200_000)).toBe("2h ago");
  });
  it("never returns a negative age", () => {
    expect(formatActivity(5000, 1000)).toBe("just now");
  });
  it("treats the full first second as 'just now'", () => {
    expect(formatActivity(0, 999)).toBe("just now");
  });
  it("rolls over to seconds at exactly one second", () => {
    expect(formatActivity(0, 1000)).toBe("1s ago");
  });
  it("shows 59s just before the minute boundary", () => {
    expect(formatActivity(0, 59_000)).toBe("59s ago");
  });
  it("rolls over to minutes at exactly one minute", () => {
    expect(formatActivity(0, 60_000)).toBe("1m ago");
  });
  it("shows 59m just before the hour boundary", () => {
    expect(formatActivity(0, 59 * 60_000)).toBe("59m ago");
  });
  it("rolls over to hours at exactly one hour", () => {
    expect(formatActivity(0, 60 * 60_000)).toBe("1h ago");
  });
});
