import { describe, it, expect, vi } from "vitest";
import { changePassword } from "@/renderer/matrix/client";

describe("changePassword", () => {
  it("calls setPassword with the m.login.password auth dict, new password, logoutDevices=false", async () => {
    const setPassword = vi.fn().mockResolvedValue({});
    const client = { getUserId: () => "@alice:rpk.chat", setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await changePassword(client, "oldpw", "newpw");
    expect(setPassword).toHaveBeenCalledWith(
      { type: "m.login.password", identifier: { type: "m.id.user", user: "@alice:rpk.chat" }, password: "oldpw" },
      "newpw",
      false,
    );
  });

  it("throws when the client has no authenticated user (and does not call setPassword)", async () => {
    const setPassword = vi.fn();
    const client = { getUserId: () => null, setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await expect(changePassword(client, "x", "y")).rejects.toThrow("Not signed in");
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("propagates the SDK rejection", async () => {
    const setPassword = vi.fn().mockRejectedValue({ errcode: "M_FORBIDDEN" });
    const client = { getUserId: () => "@a:hs", setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await expect(changePassword(client, "x", "y")).rejects.toMatchObject({ errcode: "M_FORBIDDEN" });
  });
});
