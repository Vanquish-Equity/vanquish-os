// Contract between the email reader pipeline and any model provider.
// A provider only ever sees ONE email and only returns plain JSON. It gets no
// tools, no database access and no other member's data. The pipeline never
// trusts what comes back: validate.ts checks shape, quotes and numbers.

export type EmailInput = {
  id: string;
  from: string;
  subject: string;
  bodyText: string;
  receivedAt: string; // ISO date
};

export const KINDS = ["financial_report", "funding_round", "valuation", "metrics", "other_update", "none"] as const;
export type Kind = (typeof KINDS)[number];

export const FIELDS = ["financial_report", "valuation", "round_size", "metric", "other"] as const;
export type FactField = (typeof FIELDS)[number];

export const CONFIDENCE = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export type Triage = { kind: Kind; confidence: Confidence };

export type Amount = { currency: string; value: number };

export type Fact = {
  field: FactField;
  summary: string; // one short sentence, no new facts beyond the quote
  amount?: Amount;
  quote: string; // must appear verbatim in the email
};
export type Extraction = { facts: Fact[] };

// Providers return unknown on purpose: the pipeline is the only place that
// decides what is acceptable.
export interface EmailReaderProvider {
  readonly name: string;
  triage(email: EmailInput): Promise<unknown>;
  extract(email: EmailInput, kind: Kind): Promise<unknown>;
}
