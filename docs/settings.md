# Settings

Settings is available to every active member through the account menu at the
bottom of the sidebar. Click the profile photo or name to find Settings,
Replay intro and Sign out. The account label uses the saved display name in
uppercase, falling back to the email prefix until a name is set.

## Profile

Apply `0022_member_profiles.sql` before testing profile edits in the preview.
The preview and production use the same database. The migration adds a nullable
`app_members.avatar_path`, a private `member-avatars` Storage bucket, and two
member-only RPC functions. It does not update existing names or photos. Until
it is applied, the page still loads and profile editing stays disabled.

Members can edit only their own display name and photo. The email address used
to sign in and the member's access permissions are not editable here. Photos
must be PNG, JPEG or WebP and at most 2 MB. The server checks the uploaded
file's signature; the bucket restricts objects to the member's own user ID
folder. The site renders the photo using a short-lived signed URL. Replacing
or removing the photo deletes the previous file after the new path is saved.

## Experience

Welcome intro is stored as a member-specific cookie in this browser. Turning
it off suppresses the intro at the next sign-in; **Replay intro now** still
works. Sound on/off and volume are saved in this browser's local storage.
These browser preferences do not sync to other devices. All sounds, the intro
chime and interface sounds have independent switches; volume applies to both.

## Notifications

Members can show or hide assigned tasks (also contact reminders they are included in), mentions and comment replies (also contact notes that tag them), chat
messages and assigned email drafts independently. The preference is a
member-specific browser cookie, applied to the inbox, Home, floating panel
and unread counter. Hidden notifications remain stored; re-enabling a category
shows its prior notifications again. Chat messages still exist in Chat.

## Workspace preferences

The landing page after sign-in can be Home, Overview or Pipeline; an explicit
deep link still wins. The Pipeline default can show or hide terminal outcomes;
its page toggle overrides that default. These choices use member-specific
browser cookies. Time zone and date order are saved in browser storage and
currently apply to chat and notification timestamps. Date-only CRM fields keep
their original dates. None of these preferences is synchronized between
devices.

## Admin settings

`0023_admin_settings.sql` introduces an Admin permission separate from
Portfolio and Documents and initially grants it only to Mario. RLS protects
the member list and ignored-domain list. An admin can activate or deactivate
other members, assign Portfolio, Documents and Email scouting access, and save
or remove ignored email domains. Admin cannot deactivate their own account or
grant the Admin permission through the UI RPC. Email scouting skips
ignored domains when suggesting companies. All writes are checked again
in Postgres and cannot be performed directly by regular members or anonymous
callers.

### Email scouting (`20260929190000`, built in `20261005160000`)

`email_scouting` is a per-member permission an Admin toggles in the member
list. Decided with Mario on 2026-10-05: suggestions are **private to the
member whose mailbox they came from**, and each member chooses what happens to
a new company's contacts.

- **Scan** (`src/lib/scouting/actions.ts`, logic in `detect.ts`): with the
  permission and Gmail connected, reads From/To/Cc headers of the newest 500
  emails of the last 30 days outside Spam, Trash, Chats, Promotions, Social,
  Updates and Forums. Runs from **Scan now** in Settings or the scheduled
  worker after explicit member opt-in; opening a browser tab does not scan.
- **What counts**: addresses grouped by registrable domain
  (`mail.acme.co.uk` → `acme.co.uk`), skipping the member's own domain,
  personal providers (Gmail, Outlook, iCloud, …), Admin's **ignored
  domains**, domains of existing Companies' websites, domains of People
  already linked to a company, any domain where someone is already in People,
  and automated senders (`no-reply`, `notifications`, `billing`, …). A domain
  is suggested when the member and someone there both wrote (two-way) or it
  appears in at least two threads; two-way first, then thread count.
- **Stored** (`company_suggestions`): domain, suggested name, thread count,
  two-way flag, first/last seen and up to 10 contact names/emails — never
  subjects, bodies or attachments. RLS: only the owner reads or updates their
  rows, and only members with the permission can add them. Dismissed and
  accepted suggestions are never reopened by later scans.
- **Tasks → To review → Suggested companies**: edit names, then select one or
  more rows or use **Select all** and choose **Create selected**. Each row runs
  `accept_company_suggestion` in its own transaction; it creates the company
  with `https://<domain>` and logs `COMPANY_CREATED`. Dismiss a row on its own
  or choose **Dismiss N selected** and confirm; a dismissal cannot be undone.
  The result lists successes and failures separately. Existing suggestions can
  still be reviewed if the member loses permission to scan.
- **Daily scouting notice** (`20261105100000`): a member receives one private
  notification per UTC scan day with the number of new suggestions inserted.
  Refreshing an existing suggestion or retrying an insert does not increase
  the count. An additional new suggestion makes the day's notice unread again.
  The notice contains only the count and links to To review. It follows the
  **Assigned tasks** notification preference.
- **Contacts** follow the member's Settings choice (`scouting_settings.
  contact_mode`): **Ask me first** (default) puts each new contact in
  **Tasks → To review → Contact requests** (`contact_requests`, private) to Accept
  (adds the Person under the company) or Decline; **Add automatically** adds
  them to People right away; **Don't add** skips them. Emails already in
  People are never duplicated.
- Members without the permission: their connection only powers their own
  inbox, calendar and (if they opt in) relationship history.

## Connected accounts

Each member can connect their own Google account — one connection covers
both Gmail and Calendar — from a single **Google (Gmail + Calendar)** card.
Vanquish member mailboxes are Google Workspace accounts, so Gmail (not
Outlook) is the integration target — see
[`communications.md`](communications.md#sending-later-not-implemented) for
why. Google sign-in only authenticates the user; it does not grant mailbox
or calendar access — connecting is its own, separate consent, started only
when a member clicks **Connect Google**.

The stored grant now powers the live Gmail mailbox and Calendar. See
[Communications](communications.md) and [Calendar](calendar.md). Existing
`calendar.readonly` grants can view events; Calendar's **Enable calendar
editing** link requests `calendar.events` through the same consent flow.
Connecting does not start scheduled sends; email scouting only runs for members with that permission (above).

### How it works

1. **Connect** (`/api/connections/google/start`) redirects to Google's
   consent screen for `gmail.send`, `gmail.readonly`, `gmail.modify` and
   `calendar.readonly`, with `access_type=offline` and `prompt=consent` so a
   refresh token is issued even on a reconnect. A random `state` value is
   stored in a short-lived, `httpOnly` cookie and checked on return as CSRF
   protection.
2. **Callback** (`/api/connections/google/callback`) verifies `state`,
   exchanges the code for tokens, encrypts the refresh token
   (`src/lib/connections/crypto.ts`, AES-256-GCM with the server-only
   `MAILBOX_TOKEN_ENCRYPTION_KEY`) and saves it through
   `save_mailbox_connection` — a function scoped to
   `private.current_email()`, so it can only ever write the signed-in
   member's own row — then redirects back to Settings with a status
   (`?connect=ok|declined|error|no_refresh_token|not_configured`).
3. **Storage**: `google_mailbox_connections` grants nothing to
   `authenticated` directly (RLS enabled, all privileges revoked); every
   access goes through a narrow `SECURITY DEFINER` function scoped to the
   caller's own email — `my_mailbox_connection()` (status only, no token,
   used to render the Settings card), `my_mailbox_connection_secret()`
   (the caller-scoped encrypted token, decrypted only by server code that calls
   Gmail/Calendar) and `disconnect_mailbox_connection()`. Nobody, including
   an admin, can read or act on another member's connection.
4. **Disconnect** (`disconnectGoogleMailbox`,
   `src/lib/connections/actions.ts`) decrypts the token server-side,
   best-effort revokes it with Google (so it also drops from the member's
   own Google Account permissions), then deletes the row regardless of
   whether the revoke call succeeded.

Email scouting (above) is not a narrower OAuth grant — every connection
requests the same scopes — it is a separate application-level switch on
what a future ingestion job may do with what it reads.

### Setup (one-time, per environment)

Steps 1–3 need a human with access to Google Cloud and this repo's hosting;
nothing here can be done from inside this codebase. Steps 4–5 are
environment variables — this has already been done for this project's
Vercel environments.

1. **Google Cloud project.** A Google Cloud project owned by the
   `vanquishequity.com` Workspace, at [console.cloud.google.com](https://console.cloud.google.com),
   with the **Gmail API** and **Google Calendar API** enabled
   (**APIs & Services → Library**).
2. **OAuth consent screen** (**APIs & Services → OAuth consent screen**):
   **Internal** user type — available because every account that will ever
   connect is a `vanquishequity.com` Workspace account. This skips Google's
   sensitive-scope verification review entirely (otherwise required for
   `gmail.readonly`/`gmail.modify` and can take weeks); Internal apps are
   limited to the Workspace's own users, which is exactly the audience here.
3. **OAuth client** (**APIs & Services → Credentials**): an **OAuth client
   ID** of type **Web application**, with an authorized redirect URI for
   every environment that needs one — `https://vanquish-os.vercel.app/api/connections/google/callback`
   for today's production domain, plus the same path on any custom domain
   added later and, for local development, `http://localhost:3000/api/connections/google/callback`.
   Every redirect URI actually used must be registered exactly (scheme,
   host and path).
4. **OAuth secrets**: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
   as environment variables in Vercel (Production, Preview and Development)
   and in local `.env.local`. Never commit them or paste them into chat, an
   issue, or a log — only the Vercel dashboard and `.env.local`.
5. **Token encryption key**: `MAILBOX_TOKEN_ENCRYPTION_KEY`, a random
   32-byte value, base64-encoded — generate one per environment with
   `openssl rand -base64 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
   and add it the same way as the OAuth secrets above. Losing or rotating
   this key makes every already-stored refresh token undecryptable (members
   would need to reconnect); treat it with the same care as a database
   credential.

## Verification

Run `0001` through `0022` in order on a disposable Postgres database using
`supabase/tests/local_bootstrap.sql`, reapply `0022`, then run
`supabase/tests/member_profiles.sql`. The test rolls back all inserts and
checks anonymous access, member isolation, folder policy and RPC validation.
The SQL workflow runs these checks on pull requests.
It also reapplies `0023` and runs `supabase/tests/admin_settings.sql` in the
disposable database.



## Operating workflow update

CRM synchronization has its own consent controls in Settings and Integration health. It does not turn on People relationship-history sharing. Drive read/manage scopes require Documents permission and deliberate consent. See [Operating workflows](operating-workflows.md).

Relationship history now queues the external durable worker instead of reading
Gmail/Calendar in the browser. Its consent stays independent of CRM activity
and subject/title sharing. Pause retains published history; Delete my history
removes only this member's relationship publication and private provenance and
turns that sink off. Mail header consent covers background company detection and unanswered email
reminders; company scouting retains an explicit manual scan.
Integration health exposes own-account success/checkpoint times and safe retry;
see [Sync activation runbook](runbook-sync-activation.md).

### Background company scouting

Background company detection uses the default-off **Mail header consent**
card. Opening Home or another tab does not scan Gmail. **Scan now** remains an
explicit operation independent of the background consent. Both paths
use the same per-member database lease, so only one scan can run at a time.
The scheduled worker checks due members when it runs; a successful scan is due
again after six hours. GitHub Actions scheduling can be delayed and is not a
real-time notification contract.

Both paths call the same detector over at most the newest 500 messages of the
last 30 days. Google requests specify metadata format, a header-only response
mask, and From/To/Cc only. No body, subject, attachment, or email snapshot is
stored. Suggestions retain their existing private metadata and human approval
workflow. Existing/dismissed suggestions are never reopened. New worker
suggestions increment only their owner's existing daily notice; no notification
kind is added, and no CRM Company or Person is created by a scan.

An active member, `email_scouting`, a connected Gmail mailbox with an existing
`gmail.readonly` or `gmail.modify` scope, and a current lease are required at
claim, context and commit. Background jobs also require live unified consent and the internal feature flag. Consent changes,
connection changes, permission revocation, member deactivation and machine
revocation invalidate leases. An HTTP read already in flight may finish, but
its stale lease cannot save. Existing suggestions remain private and can still
be reviewed after opting out. Direct machine table access remains denied.

The same Auth worker needs a separate owner-controlled
`company_scanning_enabled` capability and `relationships_only = false`. The new
capability defaults false. This migration does not enable an identity or opt in
a member. Directory context is limited to 10,000 entries of each kind; an
oversized directory fails closed rather than scanning with partial exclusions.

### Mail header consent (P11)

In Settings, **Allow Vanquish to read my email headers** is one explicit,
default-off choice for background company detection and unanswered email
reminders. Connecting Google, installing the migration, and enabling a worker
do not grant member consent. It covers sender and recipient details, dates,
thread IDs, and the bounded Gmail metadata described below. It does not cover
message content, stored subjects, attachments or AI. Relationship sync has a
separate card and retains its existing history and CRM publication controls.

Company detection also needs the administrator-granted `email_scouting`
permission. Reminders do not. Each feature displays whether it is off,
missing Google access or permission, waiting for an authorized worker, or
active. Active means eligible for the scheduled worker, not real-time or
exhaustive coverage. The card displays each feature's last successful review
and safe errors. Company scouting still has **Scan now** and the contact
preference under Email scouting; a manual scan grants no ongoing permission.

Uncheck the consent box to stop both background reviews and invalidate their
leases. Disconnecting Google, replacing its refresh credential, losing Gmail
read scope, deactivating a member, or removing `email_scouting` revokes both
features. Restoring access does not restart them; the member must authorize
again. If company permission is granted for the first time after opting in to
reminders, withdraw and authorize again to include it. Existing suggestions,
reminders and history are retained.

A later historical import (P10) must check this same consent and generation
when it claims, reads and commits. It has no separate permission switch: the
member must explicitly choose **Start import** and its window/preview with
consent active. P11 neither implements nor starts historical import.

Before commit, the shared reader converts international domains to ASCII/punycode,
rejects invalid domains, bounds suggestion/contact names, drops invalid contact
addresses, keeps at most ten contacts per domain and the highest-priority 500
suggestions. One malformed suggestion does not poison other valid suggestions;
the database still strictly rejects an invalid batch. Dates stay inside the read
window and never in the future. Invalid rows are discarded without logging them.

The reader and company-worker run have explicit deadlines; budget exhaustion
checkpoints `deadline`. Lost/revoked leases are abandoned and the next member can
run. An identity rejection at claim stops company work; its scheduler boundary
still lets the independent LP phase execute. Provider 401/403 map to `reconnect`,
429 to `rate_limited`; revoked authorization is separate from provider downtime.

### Unanswered email reminders (P7)

Unanswered email reminders use **Mail header consent** and need an active
member and a connected Gmail mailbox with
`https://www.googleapis.com/auth/gmail.readonly` or
`https://www.googleapis.com/auth/gmail.modify`. It requests no additional
Google scopes or app permissions. If the workspace owner has not authorized a
worker, the feature displays pending administrator activation.

The worker reviews headers in a bounded inbox sample. The latest non-draft
message must be inbound, in Inbox, and at least **five UTC calendar days** old.
The first successful review after opt-in looks back 14 days; later reviews
look back up to 30. The sender must match one active People record by exact
email, ignoring case. A company-domain match alone never creates a reminder.
Inbox delivery qualifies even when a member was copied or blind-copied;
direct-recipient headers are not requested. It skips other app members and
senders at the member's registrable company domain, including subdomains.
Shared free providers such as Gmail and Outlook are exempt from the domain
rule, but still require an exact active CRM contact match.
It skips automated senders, list/bulk/auto-reply
headers, spam, trash, chats, and promotions/social/updates/forums. Calendar
filtering excludes ICS matches in Gmail search and calendar MIME types when
present in the metadata response. Neither bodies nor attachment contents are
requested. Validate calendar filtering with a disposable mailbox before rollout.

Up to ten private reminders are created per UTC day, even if some are deleted
afterward. The remaining qualifying threads can be picked up on later runs
within the window. Search targets known CRM senders in up to eight groups of
ten addresses; the starting group rotates after a successful review. The
worker shares at most 40 candidate reads across the groups, plus 20 rotating
pending threads. Coverage remains partial on busy mailboxes. It requests only
From, List-Unsubscribe, Precedence and Auto-Submitted headers, plus the Gmail
IDs, timestamps, labels and narrowly selected MIME types. Only Gmail
thread/message IDs, time, contact/reminder links and status are stored for
deduplication. Sender addresses used for matching are not stored in the ledger.
No subjects, snippets, bodies, attachments, notifications or sends.

A newer sent message closes an open generated reminder, even if the thread
is no longer in Inbox. Completing/deleting it by hand marks that inbound
handled. A strictly newer eligible inbound message can create another one,
with at most one open reminder per thread. If a merge hides the old contact's
reminder, a newer qualifying inbound can replace it under the same daily cap.
Pending observations older than 30 UTC calendar days leave the read rotation.
Bounded cleanup marks them handled and closes any associated open generated
reminder; it leaves manual reminders and deduplication markers intact.
Pausing or revoking mail header consent preserves existing reminders and
deduplication markers.
