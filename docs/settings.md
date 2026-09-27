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
other members, assign Portfolio and Documents access, and save or remove
ignored email domains. Admin cannot deactivate their own account or grant
the Admin permission through the UI RPC. Ingestion is not connected yet:
ignored domains are saved for use when email detection is built, and do not
currently filter email or create companies. All writes are checked again in
Postgres and cannot be performed directly by regular members or anonymous
callers.

## Connected accounts

Gmail, Outlook, Google Calendar and Microsoft Calendar cards currently show
**Not available yet**. Google sign-in only authenticates the user; it does not
grant mailbox or calendar access. None of the four cards attempts OAuth or
stores access tokens. A later integration must implement provider-specific
authorization, secure token handling, disconnect/revocation, status, and sync
before showing a Connect button.

## Verification

Run `0001` through `0022` in order on a disposable Postgres database using
`supabase/tests/local_bootstrap.sql`, reapply `0022`, then run
`supabase/tests/member_profiles.sql`. The test rolls back all inserts and
checks anonymous access, member isolation, folder policy and RPC validation.
The SQL workflow runs these checks on pull requests.
It also reapplies `0023` and runs `supabase/tests/admin_settings.sql` in the
disposable database.
