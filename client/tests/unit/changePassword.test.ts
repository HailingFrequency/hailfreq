import { describe, it, expect, vi } from "vitest";
import { changePassword } from "@/renderer/matrix/client";

describe("changePassword", () => {
  it("calls setPassword with the m.login.password auth dict, new password, logoutDevices=false", async () => {
    const setPassword = vi.fn().mockResolvedValue({});
    const client = { setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await changePassword(client, "@alice:rpk.chat", "oldpw", "newpw");
    expect(setPassword).toHaveBeenCalledWith(
      { type: "m.login.password", identifier: { type: "m.id.user", user: "@alice:rpk.chat" }, password: "oldpw" },
      "newpw",
      false,
    );
  });

  it("propagates the SDK rejection", async () => {
    const setPassword = vi.fn().mockRejectedValue({ errcode: "M_FORBIDDEN" });
    const client = { setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await expect(changePassword(client, "@a:hs", "x", "y")).rejects.toMatchObject({ errcode: "M_FORBIDDEN" });
  });
});
