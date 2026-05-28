import { describe, it, expect } from "vitest";
import { normalizeUrl } from "@/renderer/screens/firstRunUtils";

describe("normalizeUrl", () => {
  it("adds https:// when scheme is missing", () => {
    expect(normalizeUrl("radio.example.com")).toBe("https://radio.example.com");
  });
  it("preserves http:// when explicit", () => {
    expect(normalizeUrl("http://radio.example.com")).toBe("http://radio.example.com");
  });
  it("strips trailing slashes", () => {
    expect(normalizeUrl("radio.example.com/")).toBe("https://radio.example.com");
    expect(normalizeUrl("https://radio.example.com///")).toBe("https://radio.example.com");
  });
  it("trims whitespace", () => {
    expect(normalizeUrl("  radio.example.com  ")).toBe("https://radio.example.com");
  });
});
