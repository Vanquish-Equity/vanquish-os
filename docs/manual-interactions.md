# Manual interactions and company review

This workflow allows members to record email, calls, meetings, or notes without
connecting a mailbox. It stores metadata entered by a member, never fetches or
sends email. Existing Company/Deal forms accept up to 20 participant emails and
show them in the activity timeline. The database, not a form field, records the
signed-in author's address. The interaction and activity entry are atomic.

Review includes **Capture an interaction** when the company is unknown. The
system auto-links only when exactly one active company matches a confirmed
person email, verified domain, exact company name or alias. Similar names are
suggestions for a human decision. Multiple conflicting matches go to Review.
Unknown contacts never create a company automatically. Domains listed under
Admin / Ignored domains, Vanquish's own domain, and public mailbox domains
cannot be used for domain matching. An interaction with only ignored/internal
participants is discarded at intake. Personal domains can still match a known
person's exact email.

Review shows participants, the entered description and candidate companies.
A member can link to a company (optionally a deal), create the named company,
or ignore. They may explicitly confirm one participant domain to teach future
matches; the system refuses ignored, internal, public, and already-owned
domains. The decision, interaction, domain learning and audit data commit as
one transaction. Multiple reviewers cannot apply the same item twice.

The schema adds `interaction_participants` (member-only read; writes through
validated RPCs), manual interaction RPCs and a new `manual_interaction_match`
Review type. No existing interactions or companies are changed. This does not
implement mailbox sync, imported email bodies, job retries, or calendar sync.
The preview shares production data, so apply the migration after a backup
before testing the new forms there.
