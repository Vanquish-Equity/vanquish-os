import { describe, expect, it } from "vitest";
import {
  contactRequestHref,
  documentHref,
  interactionHref,
  LANE_HREFS,
  openTaskHref,
  proposalHref,
  reviewItemHref,
  suggestionHref,
} from "./activity-links";

// Every item of the Activity tab opens its own record or card, not a list.
describe("Activity links", () => {
  it("open the task itself (its row in Tasks > All), not a generic /tasks", () => {
    expect(openTaskHref("t1")).toBe("/tasks?tab=all#task-t1");
  });

  it("open the company or deal an email or meeting is matched to", () => {
    expect(interactionHref({ company_id: "c1", deal_id: null })).toBe("/companies/c1");
    expect(interactionHref({ company_id: "c1", deal_id: "d1" })).toBe("/companies/c1/deals/d1");
    expect(interactionHref({ company_id: null, deal_id: "d1" })).toBe("/integrations");
  });

  it("open the document row", () => {
    expect(documentHref("doc1")).toBe("/documents#document-doc1");
  });

  it("open the decision card inside To review", () => {
    expect(proposalHref("p1")).toBe("/tasks?tab=review#proposal-p1");
    expect(reviewItemHref("r1")).toBe("/tasks?tab=review#review-r1");
    expect(suggestionHref("s1")).toBe("/tasks?tab=review#suggestion-s1");
    expect(contactRequestHref("k1")).toBe("/tasks?tab=review#contact-request-k1");
  });

  it("lane headers open the matching tab or screen, never the removed routes", () => {
    expect(LANE_HREFS).toEqual({
      activity: "/integrations",
      documents: "/documents",
      notifications: "/notifications",
      tasks: "/tasks?tab=all",
      changes: "/tasks?tab=review#suggested-changes",
      review: "/tasks?tab=review",
    });
  });
});
