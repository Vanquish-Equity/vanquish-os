import { describe, expect, it } from "vitest";
import type { GoogleClient } from "./transport";
import { verifiedMailAliases } from "./mail-completion-content";

function clientReturning(sendAs: unknown[]) {
  return {
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    request: async () => JSON.stringify({ sendAs }),
  } as unknown as GoogleClient;
}

describe("verifiedMailAliases", () => {
  it("keeps the primary address: Gmail sends no verificationStatus for it", async () => {
    const result = await verifiedMailAliases(
      clientReturning([
        { sendAsEmail: "primary@synthetic.test", isPrimary: true, isDefault: true },
        { sendAsEmail: "alias@synthetic.test", verificationStatus: "accepted" },
        { sendAsEmail: "pending@synthetic.test", verificationStatus: "pending" },
      ]),
    );
    expect(result.map((a) => a.email)).toEqual(["primary@synthetic.test", "alias@synthetic.test"]);
    expect(result[0]).toMatchObject({ primary: true, default: true });
  });
});
