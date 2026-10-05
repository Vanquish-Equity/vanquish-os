import { describe, expect, it } from "vitest";
import { summarizeRelationships } from "./summary";

describe("summarizeRelationships", () => {
  it("finds the latest touch and ranks members by days in touch", () => {
    const summary = summarizeRelationships([
      { person_id: "p", member_email: "a@v.com", kind: "email", last_at: "2026-10-01T10:00:00Z" },
      { person_id: "p", member_email: "a@v.com", kind: "meeting", last_at: "2026-10-01T15:00:00Z" },
      { person_id: "p", member_email: "b@v.com", kind: "email", last_at: "2026-09-20T10:00:00Z" },
      { person_id: "p", member_email: "b@v.com", kind: "email", last_at: "2026-09-21T10:00:00Z" },
    ]).get("p");
    expect(summary).toEqual({
      lastAt: "2026-10-01T15:00:00Z",
      lastMember: "a@v.com",
      members: [
        { email: "b@v.com", days: 2 },
        { email: "a@v.com", days: 1 },
      ],
    });
  });
});
