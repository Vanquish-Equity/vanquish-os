import { expect, it } from "vitest";
import { appendMailOpenPixel, mailOpenDigest } from "./mail-open-signal";

it("generates only an opaque HTTPS image reference and hashes its token", () => {
  const token = "a".repeat(64);
  expect(appendMailOpenPixel("<p>Test</p>", "https://synthetic.test", token)).toContain(`https://synthetic.test/api/mail/open/${token}/pixel.gif`);
  expect(mailOpenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(mailOpenDigest(token)).not.toBe(token);
  expect(() => appendMailOpenPixel("", "https://synthetic.test/path", token)).toThrow();
  expect(() => appendMailOpenPixel("", "https://synthetic.test", '" injected')).toThrow();
});
