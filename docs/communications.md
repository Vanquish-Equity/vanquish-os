# Communications to potential LPs

Prepare emails for potential LPs (investment announcements, updates,
invitations, anything else), choose recipients one by one, and keep the
result as an editable draft. **Nothing is sent yet**: delivery from the
responsible member's Outlook mailbox with recipients in BCC is a later
milestone.

Each draft has two people:

| Field | Meaning |
| --- | --- |
| **Created by** (`created_by`) | Who prepared the draft. Set by the database from the signed-in email; never changes. |
| **Responsible / planned sender** (`assigned_to`) | The active Vanquish member who reviews the draft and, once Outlook is connected, sends it from their own mailbox. Defaults to the creator; chosen from active members when creating or editing. |

Example: Mario prepares a draft and sets Pedro as responsible. Pedro finds it
under **For me** in Communications, edits it, and later sends it from his
Outlook. Mario can keep editing it too. Scott can open it but not change it.

## Where things live

| What | Where |
| --- | --- |
| Potential LPs | People → **Potential LPs** tab (`/people?view=lps`). They are regular People rows with `people.is_potential_lp = true`; emails stay in `person_emails`. There is no second contact list. |
| Add one | People → **Add potential LP** (or **New Person** with “Potential LP” ticked), or **Mark potential LP** on an existing row. A potential LP needs an email. |
| Edit name / email | **Edit** on any People row. The primary `person_emails` row is updated in place. |
| Import a list | People → **Import potential LPs (CSV)** (`/people/import`). |
| Drafts | **Communications** in the sidebar (`/communications`). Views: **For me** (you are the responsible; default when there is any), **Created by me**, **All drafts**. Each row shows who created it and who it is for. |

## Loading the LP list when it arrives

1. Save the list as CSV (Excel: *File → Save as → CSV UTF-8*). Comma,
   semicolon or tab separators all work.
2. Open People → **Import potential LPs (CSV)** and choose the file. It is
   read in the browser; nothing is saved until you confirm.
3. Check the column mapping. Headers such as `Name` / `Full name` /
   `Nombre`, `First name` + `Last name` / `Nombre` + `Apellido`, `Email` /
   `E-mail Address` / `Correo`, and optional `Title` / `Cargo` are
   recognised. If the file has no header row, untick “The first row has
   column names” and pick the columns. Other columns are ignored.
4. Review every row. Each one shows what will happen:

   | Status | Meaning | What to do |
   | --- | --- | --- |
   | Ready — new | Not in People. A person is created and marked. | Nothing. |
   | Ready — existing | The email already belongs to someone in People. That person is marked; their name is kept. | Nothing. |
   | Skipped — repeated | Same email as an earlier row of the file. | Nothing (or fix the email if it was a typo). |
   | Skipped — already LP | Already a potential LP. | Nothing. |
   | Needs review — incomplete | Missing name or email, or not exactly one valid address. | Fix it in place or **Exclude**. |
   | Needs review — same name | Someone with that name is in People without this email. | **Same person: add email to …** or **Different person: create new**, or exclude. |
   | Needs review — archived | The email belongs to an archived person. | **Restore … as potential LP** or exclude. |

5. **Import N contacts** is enabled only when nothing needs review. The
   import runs in one database transaction (`import_potential_lps`): either
   every row is saved or none is.

Emails are stored in lowercase and compared case-insensitively, so the same
address never creates a second person.

## Drafts

- **New draft** → subject, plain-text body, and the potential LP list with
  search (name, email, company, title) and filters (All / Selected / Not
  selected). One click selects or deselects a person; “Select shown” /
  “Clear shown” act on the current search.
- The counter and the **Final recipient list · BCC** show exactly who the
  draft is addressed to before saving. Contacts without an email cannot be
  selected.
- **Save draft** stores the text and the selection (`save_email_draft`, one
  transaction) and reloads it from the database, so what you see after
  saving is what was stored. Each recipient keeps the email that was
  selected.
- If a selected contact later changes in People (email edited or removed,
  unmarked as potential LP, archived or deleted) the draft shows
  “N recipients need review”, the list marks them, and the Communications
  list shows “N to review”. Choose **Use current email** or **Remove**, then
  save. Saving without deciding keeps the stored email and the warning.
- **Discard** archives the draft (it leaves the list; the row is kept).
- **Responsible / planned sender**: choose any active member. Only the
  creator and the responsible can edit, change the responsible or discard;
  every other member sees the draft read-only. If the responsible hands the
  draft to someone else, they lose edit rights (the creator keeps them).
  If the responsible is deactivated, the draft shows it and asks for a new
  one.

### Trying it before the list arrives

1. People → Potential LPs → **Add potential LP**: add yourself (for example
   `pbp@vanquishequity.com`) and one colleague who agrees to be a test
   contact.
2. Communications → **New draft**: write a subject and body, choose the
   responsible (for example Mario prepares it for Pedro), select both
   contacts, check the counter and the final list, **Save draft**.
3. Reopen the draft from the list: text and recipients are the same.
4. In People, **Edit** one of them and change the email: the draft now asks
   for a review. **Use current email** → **Save draft** clears it.
5. Unmark the test contacts (or archive them) when done. Nothing was sent at
   any point.

## Access and privacy

- Only active members (see [`authentication.md`](authentication.md)) can
  read or write potential LPs and drafts; anon has no privileges and
  signed-in non-members see nothing through the API (RLS, migration
  `0016`).
- Drafts: members read; only the creator (`created_by`, set by the
  database from the signed-in email, never from the client) and the
  responsible (`assigned_to`) update, discard, reassign or change
  recipients. The rule is enforced three times: RLS on `email_drafts` and
  `email_draft_recipients` (`private.can_edit_email_draft`), the
  `email_drafts_guard` trigger (fixed creator; the responsible must be an
  active member whenever it is set or changed) and `save_email_draft`
  (runs as the caller, so the same policies apply).
- Members are listed for the selector by `public.assignable_members()`,
  which returns only the email and display name of active members, and
  only to active members. `app_members` itself stays readable row-by-row.
- A member row that is still a draft's responsible cannot be deleted
  (foreign key); deactivate it (`is_active = false`) instead.
- Recipient lists are never put in URLs (draft pages use the draft id; the
  search box is local state), never written to `activity_events` (payloads
  carry counts only) and never echoed in error messages. Server-function
  argument logging is off in `next.config.ts` so `next dev` does not print
  addresses either.
- Potential LPs follow the same visibility as the rest of People (every
  member). If they should be restricted, add an area permission like
  `portfolio` / `documents` in a later migration.

## Tests

- Unit: `src/lib/communications/*.test.ts` (CSV parsing, column guessing,
  row review rules, recipient checks).
- Database: `supabase/tests/lp_communications.sql` — anon, non-member,
  author and another member against people, emails, drafts, recipients and
  both functions. Run only on a disposable database with `0001`–`0016`.

## Sending later (not implemented)

What connecting Outlook needs:

1. **Microsoft Entra app** (single tenant, Vanquish) with delegated
   `Mail.Send` (and `offline_access`). Admin consent per the company's
   policy. This is separate from sign-in and only asked when a user chooses
   to connect their mailbox.
2. **Token storage**: the refresh token must stay server-side (encrypted
   table readable only by a server role, or Supabase Vault), never in the
   browser or in `email_drafts`.
3. **Send path**: a server-side function that only the **responsible**
   (`assigned_to`) can call, and only with their own connected mailbox. It
   re-checks the draft (responsible is the signed-in active member, no
   recipients needing review, subject and body present), then calls
   Microsoft Graph `POST /me/sendMail` as the responsible, with the
   responsible (or an agreed address) in To and the recipients in
   `bccRecipients`. The creator cannot send on the responsible's behalf.
   Graph limits recipients per message (≈500), so large lists go in batches.
4. **Model changes**: extend `email_drafts.status` beyond `'draft'`
   (`sending`, `sent`, `failed`), add `sent_at` / `sent_by`, and freeze the
   recipient list when sending (store per-recipient delivery results).
5. **UI**: a confirmation step that shows the final BCC list and count, a
   clear “Sent on …” state, and no edits after sending.
6. **Compliance**: unsubscribe/opt-out handling and a record of consent for
   each LP, if required for the audience.
