import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

beforeAll(() => {
  process.env.MAILBOX_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a refresh token", () => {
    const token = "1//0g-fake-refresh-token-value";
    const encrypted = encryptToken(token);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptToken("same-plaintext");
    const b = encryptToken("same-plaintext");
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with a tampered tag", () => {
    const encrypted = encryptToken("secret");
    expect(() => decryptToken({ ...encrypted, tag: encryptToken("other").tag })).toThrow();
  });
});
