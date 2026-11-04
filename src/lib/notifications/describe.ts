import { memberName, type Directory } from "../chat/format";
import { myTaskHref } from "@/lib/tasks/tabs";

// Text and destination for an in-app notification. Everything shown comes
// from rows the recipient can read under RLS: the message (only while they
// are still a participant), the task, the draft or the comment (only while
// they can read its Company / Deal). Nothing else is copied.

export type NotificationKind =
  | "chat_direct"
  | "chat_mention"
  | "chat_group"
  | "task_assigned"
  | "draft_assigned"
  | "comment_mention"
  | "comment_reply"
  | "contact_reminder"
  | "contact_note_tag";

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  actor_email: string | null;
  conversation_id: string | null;
  message_id: string | null;
  task_id: string | null;
  draft_id: string | null;
  // Migration 0019; absent before it.
  comment_id?: string | null;
  // Migration 20261104140000; absent before it.
  person_id?: string | null;
  contact_reminder_id?: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationContext = {
  directory: Directory;
  conversationTitles: Map<string, string>;
  messageSnippets: Map<string, string>;
  taskTitles: Map<string, string>;
  draftSubjects: Map<string, string>;
  // Comment id -> where it lives and its text (from 0019, under RLS).
  comments?: Map<string, { record: string; href: string; snippet: string }>;
  // Contact name by person id, and reminder title by reminder id (read under
  // RLS: a reminder the recipient can no longer see has no title).
  personNames?: Map<string, string>;
  reminderTitles?: Map<string, string>;
};

export const contactHref = (personId: string | null | undefined) =>
  personId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(personId) ? `/people?contact=${personId}` : "/people";

export type NotificationView = {
  id: string;
  title: string;
  snippet: string | null;
  href: string;
  at: string;
  unread: boolean;
  kind: NotificationKind;
};

export function snippet(text: string, max = 120) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeNotification(row: NotificationRow, context: NotificationContext): NotificationView {
  const actor = row.actor_email ? memberName(context.directory, row.actor_email) : "Someone";
  const base = { id: row.id, at: row.created_at, unread: !row.read_at, kind: row.kind };
  const conversation = row.conversation_id ? context.conversationTitles.get(row.conversation_id) ?? "a conversation" : "";
  const message = row.message_id ? context.messageSnippets.get(row.message_id) ?? null : null;

  switch (row.kind) {
    case "chat_mention":
      return { ...base, title: `${actor} mentioned you in ${conversation}`, snippet: message, href: `/chat/${row.conversation_id}` };
    case "chat_direct":
      return { ...base, title: `${actor} sent you a message`, snippet: message, href: `/chat/${row.conversation_id}` };
    case "chat_group":
      return { ...base, title: `${actor} wrote in ${conversation}`, snippet: message, href: `/chat/${row.conversation_id}` };
    case "task_assigned": {
      const title = row.task_id ? context.taskTitles.get(row.task_id) : undefined;
      return {
        ...base,
        title: `${actor} assigned you a task`,
        snippet: title ?? null,
        href: myTaskHref(row.task_id as string),
      };
    }
    case "comment_mention":
    case "comment_reply": {
      const comment = row.comment_id ? context.comments?.get(row.comment_id) : undefined;
      const record = comment?.record ?? "a record";
      const withTask = row.kind === "comment_mention" && row.task_id;
      return {
        ...base,
        title:
          row.kind === "comment_reply"
            ? `${actor} replied to your comment on ${record}`
            : withTask
              ? `${actor} mentioned you and assigned you a task on ${record}`
              : `${actor} mentioned you on ${record}`,
        snippet: comment?.snippet ?? null,
        href: comment?.href ?? "/notifications",
      };
    }
    case "contact_reminder": {
      const person = row.person_id ? context.personNames?.get(row.person_id) : undefined;
      const title = row.contact_reminder_id ? context.reminderTitles?.get(row.contact_reminder_id) : undefined;
      return {
        ...base,
        title: `${actor} included you in a reminder${person ? ` on ${person}` : ""}`,
        snippet: title ?? null,
        href: contactHref(row.person_id),
      };
    }
    case "contact_note_tag": {
      const person = row.person_id ? context.personNames?.get(row.person_id) : undefined;
      return {
        ...base,
        title: `${actor} tagged you in a note on ${person ?? "a contact"}`,
        snippet: null,
        href: contactHref(row.person_id),
      };
    }
    case "draft_assigned": {
      const subject = row.draft_id ? context.draftSubjects.get(row.draft_id) : undefined;
      return {
        ...base,
        title: `${actor} prepared an email draft for you`,
        snippet: subject ? subject || "Untitled draft" : null,
        href: `/communications/${row.draft_id}`,
      };
    }
  }
}
