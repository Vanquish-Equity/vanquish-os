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

Gmail and Google Calendar cards currently show **Not available yet**. Vanquish
member mailboxes are Google Workspace accounts, so Gmail (not Outlook) is the
integration target — see [`communications.md`](communications.md#sending-later-not-implemented)
for why. Google sign-in only authenticates the user; it does not grant
mailbox or calendar access. Neither card attempts OAuth or stores access
tokens. A later integration must implement provider-specific authorization,
secure token handling, disconnect/revocation, status, and sync before showing
a Connect button.

### Building the actual connection

This is what has to happen, in order, once we're ready to make Connect real.
Steps 1–2 need a human with access to Google Cloud and this repo's hosting;
nothing here can be done from inside this codebase.

1. **Google Cloud project.** Create (or reuse) a Google Cloud project owned by
   the `vanquishequity.com` Workspace, at [console.cloud.google.com](https://console.cloud.google.com).
   In **APIs & Services → Library**, enable the **Gmail API** and the
   **Google Calendar API**.
2. **OAuth consent screen.** In **APIs & Services → OAuth consent screen**,
   choose **Internal** user type (available because every account that will
   ever connect is a `vanquishequity.com` Workspace account) — this skips
   Google's sensitive-scope verification review entirely, which otherwise
   applies to `gmail.readonly`/`gmail.modify` and can take weeks. Internal
   apps are limited to the Workspace's own users, which is exactly the
   audience here.
3. **OAuth client.** In **APIs & Services → Credentials**, create an
   **OAuth client ID** of type **Web application**. Add an authorized
   redirect URI matching wherever the callback route ends up living, e.g.
   `https://vanquish-os.vercel.app/api/connections/google/callback` (today's
   production domain — add the custom domain's equivalent too if one is set
   up later; every redirect URI actually used must be registered exactly,
   including scheme and path). Save the generated **Client ID** and **Client
   secret**.
4. **Secrets.** Add `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
   as environment variables in Vercel (Production and Preview) and in local
   `.env.local`. Never commit them or paste them into chat, an issue, or a
   log — only the Vercel dashboard and `.env.local`.
5. **Scopes**, requested separately from sign-in (`google` sign-in only
   authenticates; connecting a mailbox is its own consent, started only when
   a member clicks Connect) with `access_type=offline` for a refresh token:
   - `gmail.send` — required for every mailbox connection, to send drafts.
   - `gmail.readonly` / `gmail.modify` — only for the Inbox/Sent/Archive
     mailbox view (`communications.md`'s "Mailbox phase"); modify is also
     what archiving needs.
   - `calendar.readonly` (or `calendar.events` if writing meetings back)
     — for the Google Calendar connection.
   A member without Email scouting requests the same scopes as one with it;
   scouting is not a narrower OAuth grant, it is an application-level switch
   on what the ingestion job is allowed to do with what it reads. A metadata-
   only scope is not enough for either, since sending and Inbox/Sent both
   need message content.
6. **Code**, once steps 1–4 are done and the credentials exist as env vars:
   a connect route that starts the OAuth redirect, a callback route that
   exchanges the code for tokens, a new table for per-member connection rows
   (provider, granted scopes, encrypted refresh token via Supabase Vault or
   an equivalent, connected/revoked timestamps — this table does not exist
   yet and is deliberately not created ahead of the code that would use it),
   a disconnect action that revokes the token with Google and deletes the
   row, and the Settings cards switching from **Not available yet** to real
   Connect/Disconnect state. The mailbox scanner that Email scouting gates
   is separate follow-up work once connections themselves exist.

## Verification

Run `0001` through `0022` in order on a disposable Postgres database using
`supabase/tests/local_bootstrap.sql`, reapply `0022`, then run
`supabase/tests/member_profiles.sql`. The test rolls back all inserts and
checks anonymous access, member isolation, folder policy and RPC validation.
The SQL workflow runs these checks on pull requests.
It also reapplies `0023` and runs `supabase/tests/admin_settings.sql` in the
disposable database.
