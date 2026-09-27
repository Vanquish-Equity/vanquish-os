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

  it("shows no text it could not read", () => {
    const view = describeNotification(row({ kind: "chat_direct", conversation_id: "c2", message_id: "m2" }), context);
    expect(view.snippet).toBeNull();
  });

  it("shortens snippets", () => {
    expect(snippet("a  b\n c")).toBe("a b c");
    expect(snippet("x".repeat(200), 10)).toHaveLength(10);
  });
});
