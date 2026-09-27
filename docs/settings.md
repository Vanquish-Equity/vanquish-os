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
These browser preferences do not sync to other devices.

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
