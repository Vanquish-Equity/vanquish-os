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

Members can show or hide assigned tasks, mentions and comment replies, chat
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
grant the Admin permission through the UI RPC. Ingestion is not connected
yet: ignored domains are saved for use when email detection is built, and do
not currently filter email or create companies. All writes are checked again
in Postgres and cannot be performed directly by regular members or anonymous
callers.

### Email scouting (`20260929190000_email_scouting_permission.sql`)

Not every member does deal sourcing by email, and once a mailbox can be
connected, scanning a personal inbox to detect companies is a meaningful
thing to opt a member into rather than something every connection does by
default. `email_scouting` is a per-member permission (same
`member_permissions` table and `admin_set_member_permission` RPC as Portfolio
and Documents, toggled from the member list above) that will gate this:

- A member **with** Email scouting: once they connect Gmail, their mailbox
  activity can be scanned against the ignored-domain list to detect and
  suggest new Companies (the review queue this feeds does not exist yet).
- A member **without** it: their connection (once built) only ever powers
  their own inbox/sent/drafts view and sending — nothing about their mailbox
  content is scanned or used to create or suggest Companies.

This permission has no effect today (no mailbox is connected to scan), but is
decided per member now so the distinction is in place before scanning exists,
rather than defaulting everyone in.

## Connected accounts

Each member can connect their own Google account — one connection covers
both Gmail and Calendar — from a single **Google (Gmail + Calendar)** card.
Vanquish member mailboxes are Google Workspace accounts, so Gmail (not
Outlook) is the integration target — see
[`communications.md`](communications.md#sending-later-not-implemented) for
why. Google sign-in only authenticates the user; it does not grant mailbox
or calendar access — connecting is its own, separate consent, started only
when a member clicks **Connect Google**.

**What connecting actually does today:** stores the grant
(`20260929200000_google_mailbox_connections.sql`). **What it does not do
yet:** send drafts, show a real Inbox/Sent, or sync a calendar — those are
still separate follow-up work (`communications.md`'s "Mailbox phase") that
reads the same stored connection.

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
   (server-only: the encrypted token, for the code that will actually call
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
