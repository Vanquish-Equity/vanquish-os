# AI email reader (evaluation harness only)

Status: **nothing is connected.** No provider SDK, API key, environment
variable, database table or notification exists for this. This change only adds
the isolated reader layer and a synthetic evaluation, so a provider can be
chosen with numbers (`npm run ai:eval`). Provider, member consent and the
privacy model are still open decisions; see the product notes before wiring it.

## Three tiers

1. **Rules, no model** (`isCandidate`): only mail from a domain that matches a
   known company is ever given to a provider. Anything else never leaves the
   server.
2. **Triage** (cheap model): one question, "does this email carry a company
   fact, and what kind?". Returns `{kind, confidence}` only.
3. **Extraction** (stronger model): runs only when triage found something.
   Returns facts: `field`, one-sentence `summary`, optional `amount`, and a
   `quote`.

## The provider contract (`src/lib/ai/email-reader/types.ts`)

A provider sees **one email** and returns plain JSON. It has no tools, no
database access and no other member's data, so "do not share what belongs to
others" is enforced by what exists, not by an instruction to the model. Adding
a provider means implementing `triage` and `extract`; the pipeline owns every
decision about what is accepted.

## What the validator enforces (`validate.ts`)

- Exact shape: an unknown key at any level is rejected, so text hidden in an
  email cannot add fields or instructions to the output.
- Closed vocabularies for `kind`, `confidence` and `field`; length caps; at most
  5 facts per email.
- **The quote must appear in the email** (case and whitespace tolerant). This
  is the main control against invented facts.
- **The amount must be stated by the quote** (`money.ts` parses `$15M`,
  `USD 1.5 million`, `20 millones`, …). `1.5M` and `15M` are different numbers.
- Valuation and round size require an amount.

## Known limit: a planted sentence passes

A real quote from a known company's domain can still be false or hostile (for
example an email that says "valuation of $500M"). No quote check can tell. The
eval counts this as `planted facts` and the keyword baseline shows it
(1 case). Until a provider proves otherwise on the eval, every fact must be
confirmed by a person before anything is saved or announced, and the card must
show the sender and the exact quote.

## Running the evaluation

`npm run ai:eval` runs each provider over the synthetic cases in
`src/lib/ai/email-reader/fixtures/emails.ts` (fake companies and
`@synthetic.test` addresses only; **never add a real email, this repository is
public**). It reports triage accuracy, fact recall, amount accuracy,
unsupported facts (invented quote or number), schema violations, whether a
planted instruction was followed (canary text in the output) and planted facts.
Only the keyword baseline ships, as the floor a model must beat. Add cases for
every new failure seen in practice, and measure cost per 100 emails with the
provider's own usage numbers when an adapter is added.

## Not verified

No real provider, mailbox or database was involved. The baseline numbers
describe a keyword reader on 27 synthetic cases, not model quality.
