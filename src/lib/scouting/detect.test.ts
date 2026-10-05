import { describe, expect, it } from "vitest";
import { detectCompanies, parseNamedAddresses, registrableDomain, suggestedNameFor, websiteDomain } from "./detect";

describe("address helpers", () => {
  it("parses names and emails", () => {
    expect(parseNamedAddresses('"Pérez, Ana" <Ana@Acme.com>, bo@acme.com, Cy Lee <cy@beta.io>')).toEqual([
      { email: "ana@acme.com", name: "Pérez, Ana" },
      { email: "bo@acme.com", name: "" },
      { email: "cy@beta.io", name: "Cy Lee" },
    ]);
  });

  it("reduces hosts to the registrable domain and names it", () => {
    expect(registrableDomain("mail.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("eu.acme.com")).toBe("acme.com");
    expect(suggestedNameFor("blue-river.co.uk")).toBe("Blue River");
    expect(websiteDomain("https://www.acme.com/about")).toBe("acme.com");
    expect(websiteDomain("acme.com")).toBe("acme.com");
  });
});

describe("detectCompanies", () => {
  const options = { ownEmail: "me@vanquishequity.com", excludedDomains: new Set(["vendor.com"]), knownEmails: new Set(["known@known.com"]) };
  const msg = (threadId: string, from: string, to: string, at = "2026-10-01T10:00:00Z") => ({ threadId, at, from, to, cc: "" });

  it("suggests two-way conversations and repeat senders, skipping noise", () => {
    const found = detectCompanies(
      [
        msg("t1", "Ana <ana@acme.com>", "me@vanquishequity.com"),
        msg("t1", "me@vanquishequity.com", "ana@acme.com", "2026-10-02T10:00:00Z"),
        msg("t2", "news@beta.io", "me@vanquishequity.com"),
        msg("t3", "x@gamma.io", "me@vanquishequity.com"),
        msg("t4", "y@gamma.io", "me@vanquishequity.com"),
        msg("t5", "pal@gmail.com", "me@vanquishequity.com"),
        msg("t6", "boss@vendor.com", "me@vanquishequity.com"),
        msg("t7", "known@known.com", "me@vanquishequity.com"),
        msg("t8", "me@vanquishequity.com", "known@known.com"),
        msg("t9", "colleague@vanquishequity.com", "me@vanquishequity.com"),
        msg("t10", "solo@once.io", "me@vanquishequity.com"),
      ],
      options,
    );
    expect(found.map((company) => [company.domain, company.twoWay, company.threadCount])).toEqual([
      ["acme.com", true, 1],
      ["gamma.io", false, 2],
    ]);
    expect(found[0]).toMatchObject({
      suggestedName: "Acme",
      firstSeen: "2026-10-01T10:00:00.000Z",
      lastSeen: "2026-10-02T10:00:00.000Z",
      contacts: [{ email: "ana@acme.com", name: "Ana" }],
    });
  });
});
