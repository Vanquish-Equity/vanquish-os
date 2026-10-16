export type MailCompletionOperation = "save" | "send" | "discard";
export type VerifiedAlias = {
  email: string;
  primary: boolean;
  default: boolean;
};
export type ForwardSource = { messageId: string; partIds: string[] };
export type MailReview = {
  id: string;
  operation: MailCompletionOperation;
  sender: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments: { name: string; size: number }[];
  expiresAt: string;
  draftRetained: boolean;
};
export type MailReviewRow = {
  id: string;
  operation: MailCompletionOperation;
  state: "pending" | "claimed" | "cancelled" | "completed" | "uncertain";
  created_at: string;
};
export const MAIL_ATTACHMENT_LIMIT = 2 * 1024 * 1024;
export const MAIL_CHUNK_LIMIT = 256 * 1024;
