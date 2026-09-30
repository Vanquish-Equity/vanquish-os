export type MailFolder =
  | "inbox"
  | "sent"
  | "archive"
  | "starred"
  | "all"
  | "trash"
  | "spam"
  | "gmail-drafts";
export const MAIL_FOLDERS: { key: MailFolder; label: string; query: string }[] =
  [
    { key: "inbox", label: "Inbox", query: "in:inbox" },
    {
      key: "starred",
      label: "Starred",
      query: "is:starred -in:trash -in:spam",
    },
    { key: "sent", label: "Sent", query: "in:sent" },
    { key: "gmail-drafts", label: "Gmail drafts", query: "in:drafts" },
    {
      key: "archive",
      label: "Archive",
      query: "-in:inbox -in:sent -in:drafts -in:trash -in:spam",
    },
    { key: "all", label: "All mail", query: "-in:trash -in:spam" },
    { key: "spam", label: "Spam", query: "in:spam" },
    { key: "trash", label: "Trash", query: "in:trash" },
  ];
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
export type GmailThread = {
  id: string;
  messages?: GmailMessage[];
  snippet?: string;
};
export type MailAttachment = {
  id: string | null;
  partId: string;
  name: string;
  size: number;
  mimeType: string;
};
export type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  subject: string;
  date: string;
  messageId: string;
  references: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
  labels: string[];
};
export type MailThreadSummary = {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  count: number;
  hasAttachments: boolean;
  labels: string[];
};
export type MailPage = {
  threads: MailThreadSummary[];
  nextPageToken: string | null;
  estimate: number;
};
export type ComposeInput = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  threadId?: string;
  replyMessageId?: string;
  references?: string;
};
export type MailOperation =
  | "archive"
  | "inbox"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "trash"
  | "restore"
  | "spam"
  | "not-spam";
