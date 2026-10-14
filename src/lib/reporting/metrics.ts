export type Flow = {
  date: string;
  currency: string;
  kind: "capital_call" | "contribution" | "distribution";
  amount: string;
};
export type MetricInput = {
  status: string;
  asOf: string;
  basis: "gross" | "net";
  currency?: string;
  nav?: string | null;
  navOn?: string | null;
  reconciled?: boolean;
  flows?: Flow[];
};
export type Metrics = {
  status: "available" | "unavailable" | "ambiguous";
  reason: string;
  asOf: string;
  basis: string;
  currency?: string;
  called?: number;
  paid?: number;
  distributions?: number;
  dpi?: number;
  tvpi?: number;
  xirr?: number;
};
const day = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time / 86400000
    : NaN;
};
// Exact cents within JS safe-integer bounds; unsupported precision fails closed.
const cents = (value: string) => {
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : NaN;
};
// Deliberately conservative: generalized Descartes' rule proves uniqueness only
// with one sign change in date-ordered, coalesced flows. Multiple changes are
// ambiguous even when a numerical solver could select one of several roots.
export function xirr(
  flows: { date: string; amount: number }[],
):
  | { status: "available"; value: number }
  | { status: "unavailable" | "ambiguous"; reason: string } {
  if (!flows.length || flows.length > 2001)
    return { status: "unavailable", reason: "flow_limit" };
  const grouped = new Map<number, number>();
  for (const f of flows) {
    const date = day(f.date);
    if (!Number.isFinite(date) || !Number.isFinite(f.amount))
      return { status: "unavailable", reason: "invalid_flow" };
    grouped.set(date, (grouped.get(date) ?? 0) + f.amount);
  }
  const ordered = [...grouped]
    .sort((a, b) => a[0] - b[0])
    .filter(([, n]) => n !== 0);
  let changes = 0;
  for (let i = 1; i < ordered.length; i++)
    if (Math.sign(ordered[i][1]) !== Math.sign(ordered[i - 1][1])) changes++;
  if (changes > 1)
    return { status: "ambiguous", reason: "multiple_sign_changes" };
  if (changes === 0 || ordered.length < 2)
    return { status: "unavailable", reason: "no_root" };
  const origin = ordered[0][0];
  const npv = (x: number) => {
    const terms = ordered.map(([d, c]) => ({
      c,
      exponent: (-(d - origin) / 365) * x,
    }));
    const scale = Math.max(...terms.map((t) => t.exponent));
    return terms.reduce(
      (sum, t) => sum + t.c * Math.exp(t.exponent - scale),
      0,
    );
  };
  let lo = -20,
    hi = 20,
    left = npv(lo),
    right = npv(hi);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left * right >= 0)
    return { status: "unavailable", reason: "no_root_in_supported_range" };
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2,
      value = npv(mid);
    if (Math.sign(value) === Math.sign(left)) {
      lo = mid;
      left = value;
    } else {
      hi = mid;
      right = value;
    }
  }
  const value = Math.expm1((lo + hi) / 2);
  return Number.isFinite(value)
    ? { status: "available", value }
    : { status: "unavailable", reason: "non_finite_root" };
}
export function fundMetrics(input: MetricInput, portfolio: boolean): Metrics {
  const base = {
    asOf: input.asOf,
    basis: input.basis,
    currency: input.currency,
  };
  const unavailable = (reason: string): Metrics => ({
    ...base,
    status: "unavailable",
    reason,
  });
  if (!portfolio) return unavailable("portfolio_required");
  if (input.basis !== "net") return unavailable("gross_basis_contract_pending");
  if (input.status !== "inputs" || !input.reconciled)
    return unavailable("not_reconciled");
  if (
    !Number.isFinite(day(input.asOf)) ||
    !["gross", "net"].includes(input.basis)
  )
    return unavailable("invalid_date_or_basis");
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency))
    return unavailable("invalid_currency");
  if (input.nav == null || input.nav === "" || input.navOn !== input.asOf)
    return unavailable("dated_nav_required");
  const navCents = cents(input.nav);
  const nav = navCents / 100;
  if (!Number.isFinite(nav) || nav < 0) return unavailable("invalid_nav");
  if (!input.flows?.length || input.flows.length > 2000)
    return unavailable("flow_limit_or_empty");
  let called = 0,
    paid = 0,
    distributions = 0;
  const cash: { date: string; amount: number }[] = [];
  for (const f of input.flows) {
    const flowCents = cents(f.amount);
    const amount = flowCents / 100;
    if (f.currency !== input.currency) return unavailable("mixed_currencies");
    if (
      !Number.isFinite(day(f.date)) ||
      day(f.date) > day(input.asOf) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount >= 1e16
    )
      return unavailable("invalid_flow");
    if (f.kind === "capital_call") called += flowCents;
    else if (f.kind === "contribution") {
      paid += flowCents;
      cash.push({ date: f.date, amount: -amount });
    } else if (f.kind === "distribution") {
      distributions += flowCents;
      cash.push({ date: f.date, amount });
    } else return unavailable("unclassified_flow");
  }
  if (
    ![called, paid, distributions, distributions + navCents].every(
      Number.isSafeInteger,
    )
  )
    return unavailable("unsupported_amount_precision");
  called /= 100;
  paid /= 100;
  distributions /= 100;
  if (paid <= 0) return unavailable("zero_paid_in");
  cash.push({ date: input.asOf, amount: nav });
  const root = xirr(cash);
  if (root.status !== "available")
    return { ...base, status: root.status, reason: root.reason };
  return {
    ...base,
    status: "available",
    reason: "Reconciled input attestation; verify accounting basis.",
    called,
    paid,
    distributions,
    dpi: distributions / paid,
    tvpi: (distributions + nav) / paid,
    xirr: root.value,
  };
}
