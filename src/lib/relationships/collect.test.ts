import { describe, expect, it } from "vitest";
import { collectInteractions, gmailContactQuery } from "./collect";

const people = new Map([
  ["ana@acme.com", ["p-ana"]],
  ["bo@acme.com", ["p-bo"]],
]);

describe("collectInteractions", () => {
  it("keeps one row per person, kind and day with the latest time", () => {
    const rows = collectInteractions(
      people,
      [
        { at: "2026-10-01T09:00:00Z", addresses: ["Ana@acme.com", "me@vanquish.com"] },
        { at: "2026-10-01T17:00:00Z", addresses: ["ana@acme.com"] },
        { at: "2026-10-02T08:00:00Z", addresses: ["stranger@x.com"] },
      ],
      [
        { at: "2026-10-03T15:00:00Z", attendees: ["bo@acme.com", "me@vanquish.com"] },
        { at: "2026-10-04T15:00:00Z", status: "cancelled", attendees: ["bo@acme.com"] },
      ],
      "me@vanquish.com",
    );
    expect(rows).toEqual([
      { person_id: "p-ana", kind: "email", occurred_on: "2026-10-01", last_at: "2026-10-01T17:00:00.000Z" },
      { person_id: "p-bo", kind: "meeting", occurred_on: "2026-10-03", last_at: "2026-10-03T15:00:00.000Z" },
    ]);
  });
});

describe("gmailContactQuery", () => {
  it("searches from/to/cc for each address after the date, outside trash and spam", () => {
    expect(gmailContactQuery(["a@x.com"], new Date("2026-10-01T00:00:00Z"))).toBe(
      'after:1790812800 -in:trash -in:spam -in:chats (from:"a@x.com" OR to:"a@x.com" OR cc:"a@x.com")',
    );
  });
});
