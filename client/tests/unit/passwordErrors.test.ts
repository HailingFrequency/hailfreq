import { describe, it, expect } from "vitest";
import { validateNewPassword, mapPasswordChangeError } from "@/renderer/matrix/passwordErrors";

describe("validateNewPassword", () => {
  it("rejects an empty new password", () => {
    expect(validateNewPassword("", "")).toBe("Enter a new password");
  });
  it("rejects a mismatch", () => {
    expect(validateNewPassword("abc", "abd")).toBe("Passwords do not match");
  });
  it("accepts a matching non-empty password", () => {
    expect(validateNewPassword("hunter2", "hunter2")).toBeNull();
  });
});

describe("mapPasswordChangeError", () => {
  it("maps M_FORBIDDEN to a current-password message", () => {
    expect(mapPasswordChangeError({ errcode: "M_FORBIDDEN" })).toBe("Current password is incorrect.");
  });
  it("surfaces the server's message for a policy rejection", () => {
    expect(mapPasswordChangeError({ errcode: "M_PASSWORD_TOO_SHORT", data: { error: "Password too short" } }))
      .toBe("Password too short");
  });
  it("falls back to a generic message for unknown errors", () => {
    expect(mapPasswordChangeError(new Error("network"))).toBe("Couldn't change password. Please try again.");
  });
  it("caps an over-long server message at 200 chars", () => {
    const long = "x".repeat(500);
    expect(mapPasswordChangeError({ errcode: "M_UNKNOWN", data: { error: long } }).length).toBe(200);
  });
  it("falls through to generic when the server error is whitespace-only", () => {
    expect(mapPasswordChangeError({ errcode: "M_UNKNOWN", data: { error: "   " } }))
      .toBe("Couldn't change password. Please try again.");
  });
});
