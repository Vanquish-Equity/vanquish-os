import { describe, expect, it } from "vitest";
import { toDirectory } from "../chat/format";
import { describeNotification, snippet, type NotificationRow } from "./describe";

const directory = toDirectory([{ email: "membera@synthetic.test", display_name: "Alpha", is_active: true }]);
const context = {
  directory,
  conversationTitles: new Map([["c1", "Deal team"]]),
  messageSnippets: new Map([["m1", "@Beta revisá el memo"]]),
  taskTitles: new Map([["t1", "Call LP"]]),
  draftSubjects: new Map([["d1", "Q3 update"]]),
  comments: new Map([["k1", { record: "Acme · Seed", href: "/companies/co/deals/de#comment-k1", snippet: "@Beta send the memo" }]]),
};
const row = (patch: Partial<NotificationRow>): NotificationRow => ({
  id: "n1", kind: "chat_direct", actor_email: "membera@synthetic.test", conversation_id: null, message_id: null,
  task_id: null, draft_id: null, created_at: "2026-09-27T10:00:00Z", read_at: null, ...patch,
});

describe("describeNotification", () => {
  it("links each kind to its destination", () => {
    expect(describeNotification(row({ kind: "chat_mention", conversation_id: "c1", message_id: "m1" }), context)).toMatchObject({
      title: "Alpha mentioned you in Deal team", snippet: "@Beta revisá el memo", href: "/chat/c1", unread: true,
    });
    expect(describeNotification(row({ kind: "chat_group", conversation_id: "c1", message_id: "m1" }), context).title).toBe("Alpha wrote in Deal team");
    expect(describeNotification(row({ kind: "task_assigned", task_id: "t1", read_at: "x" }), context)).toMatchObject({
      title: "Alpha assigned you a task", snippet: "Call LP", href: "/tasks?tab=mine#task-t1", unread: false,
    });
    expect(describeNotification(row({ kind: "draft_assigned", draft_id: "d1" }), context).href).toBe("/communications/d1");
  });

  it("links comment notices to the exact comment", () => {
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k1" }), context)).toMatchObject({
      title: "Alpha mentioned you on Acme · Seed",
      snippet: "@Beta send the memo",
      href: "/companies/co/deals/de#comment-k1",
    });
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k1", task_id: "t9" }), context).title).toBe(
      "Alpha mentioned you and assigned you a task on Acme · Seed"
    );
    expect(describeNotification(row({ kind: "comment_reply", comment_id: "k1" }), context).title).toBe(
      "Alpha replied to your comment on Acme · Seed"
    );
  });

  it("shows no text it could not read", () => {
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k2" }), context)).toMatchObject({
      snippet: null,
      title: "Alpha mentioned you on a record",
    });
    const view = describeNotification(row({ kind: "chat_direct", conversation_id: "c2", message_id: "m2" }), context);
    expect(view.snippet).toBeNull();
  });

  it("shortens snippets", () => {
    expect(snippet("a  b\n c")).toBe("a b c");
    expect(snippet("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("contact notifications", () => {
  const person = "11111111-1111-1111-1111-111111111111";
  const withContacts = { ...context, personNames: new Map([[person, "Ana Lopez"]]), reminderTitles: new Map([["r1", "Send deck"]]) };

  it("opens the contact drawer and shows only what the recipient can read", () => {
    expect(describeNotification(row({ kind: "contact_reminder", person_id: person, contact_reminder_id: "r1" }), withContacts)).toMatchObject({
      title: "Alpha included you in a reminder on Ana Lopez", snippet: "Send deck", href: `/people?contact=${person}`,
    });
    expect(describeNotification(row({ kind: "contact_note_tag", person_id: person }), withContacts)).toMatchObject({
      title: "Alpha tagged you in a note on Ana Lopez", snippet: null, href: `/people?contact=${person}`,
    });
  });

  it("never copies a note body and falls back safely", () => {
    const view = describeNotification(row({ kind: "contact_reminder", person_id: "bad id", contact_reminder_id: "gone" }), withContacts);
    expect(view).toMatchObject({ snippet: null, href: "/people" });
    expect(describeNotification(row({ kind: "contact_note_tag", person_id: null }), context).title).toBe("Alpha tagged you in a note on a contact");
  });
});

it.each([[1, "1 new company detected"], [4, "4 new companies detected"], [null, "New companies detected"]] as const)(
  "shows a count-only scouting notification and links to To review",
  (count, title) => {
    const view = describeNotification(row({ kind: "company_suggestions_digest", company_suggestions_count: count }), context);
    expect(view).toMatchObject({ title, snippet: null, href: "/tasks?tab=review#suggested-companies" });
  },
);
