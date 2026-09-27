import { describe, expect, it } from "vitest";
import { toDirectory } from "../chat/format";
import { describeNotification, snippet, type NotificationRow } from "./describe";

const directory = toDirectory([{ email: "marios@vanquishequity.com", display_name: "Mario", is_active: true }]);
const context = {
  directory,
  conversationTitles: new Map([["c1", "Deal team"]]),
  messageSnippets: new Map([["m1", "@Pedro revisá el memo"]]),
  taskTitles: new Map([["t1", "Call LP"]]),
  draftSubjects: new Map([["d1", "Q3 update"]]),
  comments: new Map([["k1", { record: "Acme · Seed", href: "/companies/co/deals/de#comment-k1", snippet: "@Pedro send the memo" }]]),
};
const row = (patch: Partial<NotificationRow>): NotificationRow => ({
  id: "n1", kind: "chat_direct", actor_email: "marios@vanquishequity.com", conversation_id: null, message_id: null,
  task_id: null, draft_id: null, created_at: "2026-09-27T10:00:00Z", read_at: null, ...patch,
});

describe("describeNotification", () => {
  it("links each kind to its destination", () => {
    expect(describeNotification(row({ kind: "chat_mention", conversation_id: "c1", message_id: "m1" }), context)).toMatchObject({
      title: "Mario mentioned you in Deal team", snippet: "@Pedro revisá el memo", href: "/chat/c1", unread: true,
    });
    expect(describeNotification(row({ kind: "chat_group", conversation_id: "c1", message_id: "m1" }), context).title).toBe("Mario wrote in Deal team");
    expect(describeNotification(row({ kind: "task_assigned", task_id: "t1", read_at: "x" }), context)).toMatchObject({
      title: "Mario assigned you a task", snippet: "Call LP", href: "/tasks?view=mine#task-t1", unread: false,
    });
    expect(describeNotification(row({ kind: "draft_assigned", draft_id: "d1" }), context).href).toBe("/communications/d1");
  });

  it("links comment notices to the exact comment", () => {
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k1" }), context)).toMatchObject({
      title: "Mario mentioned you on Acme · Seed",
      snippet: "@Pedro send the memo",
      href: "/companies/co/deals/de#comment-k1",
    });
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k1", task_id: "t9" }), context).title).toBe(
      "Mario mentioned you and assigned you a task on Acme · Seed"
    );
    expect(describeNotification(row({ kind: "comment_reply", comment_id: "k1" }), context).title).toBe(
      "Mario replied to your comment on Acme · Seed"
    );
  });

  it("shows no text it could not read", () => {
    expect(describeNotification(row({ kind: "comment_mention", comment_id: "k2" }), context)).toMatchObject({
      snippet: null,
      title: "Mario mentioned you on a record",
    });
    const view = describeNotification(row({ kind: "chat_direct", conversation_id: "c2", message_id: "m2" }), context);
    expect(view.snippet).toBeNull();
  });

  it("shortens snippets", () => {
    expect(snippet("a  b\n c")).toBe("a b c");
    expect(snippet("x".repeat(200), 10)).toHaveLength(10);
  });
});
