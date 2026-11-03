import { REVIEW_HREF, taskHref, tasksTabHref } from "@/lib/tasks/tabs";

// Where each item of the Activity tab (the former Action center) opens. Every
// item links to its own record or card, built from routes that already exist:
// a task (its row in Tasks > All, highlighted from the hash), a company or
// deal page, a document row, a decision card in To review. The old lanes sent
// open tasks to a generic /tasks and every decision to /review.

export const ACTIVITY_FALLBACK_HREF = "/integrations";

// An email or meeting event: the company page (or the deal page) it is linked
// to; with no company yet, the integration health screen where it is matched.
export function interactionHref(item: { company_id: string | null; deal_id: string | null }) {
  if (!item.company_id) return ACTIVITY_FALLBACK_HREF;
  return `/companies/${item.company_id}${item.deal_id ? `/deals/${item.deal_id}` : ""}`;
}

export const documentHref = (documentId: string) => `/documents#document-${documentId}`;
export const openTaskHref = taskHref;
export const proposalHref = (id: string) => `${REVIEW_HREF}#proposal-${id}`;
export const reviewItemHref = (id: string) => `${REVIEW_HREF}#review-${id}`;
export const suggestionHref = (id: string) => `${REVIEW_HREF}#suggestion-${id}`;
export const contactRequestHref = (id: string) => `${REVIEW_HREF}#contact-request-${id}`;

// The "Open" link in each lane's header.
export const LANE_HREFS = {
  activity: "/integrations",
  documents: "/documents",
  notifications: "/notifications",
  tasks: tasksTabHref("all"),
  changes: `${REVIEW_HREF}#suggested-changes`,
  review: REVIEW_HREF,
} as const;
