# Communications and email

Communications (`/communications`) is a live view of the signed-in member's
Google mailbox. Vanquish accounts are Google Workspace accounts; Outlook is
another client for the same Gmail mailbox. No Microsoft Graph connection is
needed. Google's mailbox is the source of truth, including Sent and drafts.

## Mailbox

- Inbox, Starred, Sent, Gmail drafts, Archive, All mail, Spam and Trash show
  real Gmail conversations, 25 per page, with forward/back pagination.
- Search accepts Gmail operators (`from:`, `subject:`, `after:`, etc.).
  Unread and attachment filters combine with the folder and search.
- Opening a conversation loads all its messages and marks it read on a
  best-effort basis. Mark read/unread explicitly if Google denies that action.
  Stars, archive, trash, restore and spam recovery modify Google labels.
  Bulk actions report partial failures; they do not claim all rows succeeded.
- Custom Gmail labels can be created, renamed, deleted, applied or removed.
  Deleting a label keeps its messages. Labels are private to the mailbox.
- Reply, Reply all and Forward open the rich-text composer. Replies carry
  `threadId`, `In-Reply-To` and `References`; BCC never becomes a reply-all
  recipient. Quoted reply/forward content uses the original plain-text body.
  HTML-only messages are kept readable in their original conversation;
  forwarding their complete HTML layout and attachments is not automatic.
- Attachments download through an authenticated server route, scoped to
  `users/me`, with forced download under the original file name and no
  caching. Gmail attachment IDs are validated with their own, longer limit
  (they run to hundreds of characters); before that fix every download failed
  and the browser saved the error as `attachment.txt`. Email HTML runs inside an
  opaque-origin sandbox with CSP. Scripts, forms and embedded content cannot
  execute; remote images are blocked until explicitly enabled for that message.
- `c` opens compose and `/` focuses search outside editable fields. Folder
  selection and searches stay in browser memory; Refresh fetches Google again.

Archive deliberately excludes Inbox, Sent, Drafts, Spam and Trash; All mail
includes received and sent mail outside Spam and Trash. Gmail may return a
conversation containing messages with different labels. Thread actions act
on the entire conversation, matching the UI's wording.

This implementation reads Google on demand; it does not copy private mailbox
content into shared CRM tables. The one exception is opt-in relationship
history, which stores only who emailed or met which Person on which day (see
[`crm-workspace.md`](crm-workspace.md#relationship-history-shared-opt-in)). Metadata fan-out is limited to five requests
at once, and message bodies/attachment bytes load only when needed. There is
no push subscription or `historyId` synchronization worker yet.

## Compose and delivery

To/CC/BCC suggest matching People contacts and active workspace members while
typing a name or email. Suggestions show both name and address; selecting one
replaces only the recipient at the cursor. Use arrows and Enter to choose,
Escape to dismiss, or click an option. Names match without accents and duplicate
addresses are collapsed. This uses the existing member-visible CRM directory;
it does not query Google Contacts or mine private email history.

Drag the composer header to move the window, or focus the header and use arrow
keys. Home centers it. Movement stays inside the viewport and reclamps when its
size or the viewport changes. Full screen centers the composer and disables
dragging; restoring returns to the centered movable size. Closing/sending and
unsaved-change confirmation retain their existing behavior.

The composer supports To, CC, BCC, rich text, People/group selection,
individual or bulk recipients, and up to ten uploaded attachments (2 MB
combined, including retained attachments when editing). Larger existing
messages can be read/downloaded and unmodified Gmail drafts can be sent;
editing attachments above this limit must be done through Gmail. Email addresses and headers are
validated server-side; HTML uses a parser-backed allowlist (`sanitize-html`),
which also keeps `https` images (signature logos) and drops any other image.

New messages and replies start with the member's Gmail signature (the
default "Send mail as" address, read with `users.settings.sendAs.list`
through the existing Gmail read grant), placed above any quoted text and
editable like the rest of the body. A reopened draft is left as saved. If the
signature can't be read, the composer opens without it.

**Save to Gmail** creates or updates a real Gmail draft. Empty recipients are
allowed while saving; sending requires 1–200 valid recipients. The sender
comes from the connected Gmail profile, never a client-supplied From address.
Edits retain selected existing attachments. A changed Gmail draft message ID
requires reopening before saving, to reduce accidental overwrites from
another client (Gmail does not provide an atomic compare-and-swap draft write).

**Send → Confirm send** saves the current message, then calls `drafts.send`.
Gmail consumes that draft and adds the message to Sent. There are no automatic
send retries. If delivery is uncertain, the composer blocks retry and asks
the member to check Gmail/Sent first; it never reports success without a Google
response. A successful draft write followed by a failed read preserves the
draft ID and asks for a reload rather than creating another draft.

## CRM drafts and People groups

CRM drafts (`/communications?folder=drafts`) remain distinct from private
Gmail drafts. Active members can read them; only their creator can edit or
discard them. `created_by` is immutable and database-controlled. Groups in
People are shared directory groups, not mailbox sharing permissions.

The CRM editor defaults to the editable Potential LPs group, lets the creator
select any People/group, choose To/CC/BCC, and review changed contact addresses.
**Send via Gmail** (the primary action in the draft's bottom bar) copies the
current text and selected addresses into a private Gmail composition, where
the creator reviews and confirms sending. Only the creator sees that
control, disabled until there is at least one recipient and none need
review. It does not change the saved CRM draft into a delivery ledger: CRM
drafts stay labeled **CRM draft**, and actual delivery is shown in Gmail
Sent. Saving a CRM draft alone never sends email.

`scheduled_at` is a planning note only. There is no scheduler or automatic
send job; connecting Google does not activate old planned times. Scheduled
sending and CRM delivery history require a separate job/ledger design.

## Contact import

People → Import potential LPs accepts CSV with comma, semicolon or tab
separators, optional headers, name/full-name or first+last columns, email and
title. Review new, existing, repeated, incomplete, ambiguous-name or archived
contacts before confirming. `import_potential_lps` commits all reviewed rows
in one transaction. Emails are compared case-insensitively. Groups can be
created, renamed and edited in `/people/groups`; deleting a group keeps People.

## Access and implementation

- Every Google server action verifies active Vanquish membership, loads only
  `my_mailbox_connection_secret()` for the caller, and decrypts the refresh
  token server-side. Tokens never appear in action results or shared caches.
- Gmail endpoints always use `users/me`. Server actions never accept another
  member's mailbox identity. Scope checks enforce read vs modify/send rights.
- Provider requests and attachment responses use `no-store`; provider error
  bodies and credentials are not returned or logged. Server-function argument
  logging remains disabled in `next.config.ts`.
- CRM recipient RLS and creator-only rules remain enforced by migrations
  `0016`, `0020`, `20260929170500` and `20260929220000`. Deleted/changed People
  retain their selected address snapshot and need review before handoff.
- `src/lib/google/client.ts`: caller-scoped refresh, API transport, safe errors.
  `mail-actions.ts`: live queries/mutations. `mail-format.ts`: MIME parsing and
  writing. `mail-validation.ts`: shared address/header validation.
  `src/components/mail`: workspace, sandboxed message body, composer.

## Validation and remaining work

Unit tests cover MIME alternatives, encoded headers, attachments, quoted
address names, injection rejection, sender isolation, scope enforcement,
no automatic retry, draft conflict/preservation and Google pagination.
Run lint, TypeScript, unit tests and build; SQL tests for CRM drafts run only
on a disposable database. This change uses existing connection storage and
needs no database migration.

Before merging, a connected-member preview must verify actual Google folder
contents, sending to an agreed test recipient, Sent visibility in Gmail and
Outlook, editing a Gmail draft with attachments and revoked-grant handling.
No test emails are sent automatically by CI or by implementing this code.

Not yet implemented: push updates, scheduled sending, send-as aliases,
complete forwarding of HTML/attachments, large/resumable uploads, email
signatures/settings, Google rules and offline search. These are separate
iterations; the current folders and actions use real Google data.

References: [Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads),
[sending MIME](https://developers.google.com/workspace/gmail/api/guides/sending),
[labels](https://developers.google.com/workspace/gmail/api/guides/labels),
[scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes).
