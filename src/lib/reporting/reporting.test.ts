import { describe, it, expect } from "vitest";
import { csvCell, collectExport, exportCsv, type ExportRow } from "./csv";
import { fundMetrics, xirr, type MetricInput } from "./metrics";
const input: MetricInput = {
  status: "inputs",
  asOf: "2026-01-01",
  basis: "net",
  currency: "USD",
  reconciled: true,
  nav: "80",
  navOn: "2026-01-01",
  flows: [
    {
      date: "2025-01-01",
      kind: "capital_call",
      currency: "USD",
      amount: "200",
    },
    {
      date: "2025-01-01",
      kind: "contribution",
      currency: "USD",
      amount: "100",
    },
    { date: "2026-01-01", kind: "distribution", currency: "USD", amount: "40" },
  ],
};
describe("authorized reporting", () => {
  it.each(["=SUM(A1)", "+1", "-3", "@formula", "\tformula", "\rformula"])(
    "escapes formula prefix %j",
    (value) => expect(csvCell(value)).toBe("\"'" + value + '"'),
  );
  it("quotes RFC-style cells and retains Unicode", () =>
    expect(csvCell('a,"é\n')).toBe('"a,""é\n"'));
  it("labels currency/timezone and consistency", () => {
    const csv = exportCsv("funds", [], false);
    expect(csv).toContain("ISO 4217");
    expect(csv).toContain("UTC");
    expect(csv).toContain("not an accounting snapshot");
  });
  it("stops at 5000 and uses strictly increasing keyset cursor", async () => {
    let batches = 0;
    const r = await collectExport(async (after) => {
      const offset = after ? Number(after) : 0;
      batches++;
      return Array.from({ length: 250 }, (_, i) => ({
        id: String(offset + i + 1).padStart(8, "0"),
        name: "Synthetic",
        currency: "N/A",
        amount: null,
        created_at: null,
      }));
    });
    expect(r.rows).toHaveLength(5000);
    expect(r.capped).toBe(true);
    expect(batches).toBe(20);
  });
  it("does not return buffered data after later permission denial", async () => {
    let n = 0;
    await expect(
      collectExport(async () => {
        if (n++) throw Error("Revoked");
        return Array.from(
          { length: 250 },
          (_, i) => ({ id: String(i).padStart(5, "0") }) as ExportRow,
        );
      }),
    ).rejects.toThrow("Revoked");
  });
  it("rejects broken cursors", async () => {
    await expect(
      collectExport(async () => [{ id: "2" }, { id: "1" }] as ExportRow[]),
    ).rejects.toThrow("cursor");
  });
  it("computes known net metrics; calls do not count as paid", () => {
    const r = fundMetrics(input, true);
    expect(r.status).toBe("available");
    expect(r.called).toBe(200);
    expect(r.paid).toBe(100);
    expect(r.dpi).toBeCloseTo(0.4);
    expect(r.tvpi).toBeCloseTo(1.2);
    expect(r.xirr).toBeCloseTo(0.2, 10);
  });
  it("denies Portfolio-less callers without metrics", () => {
    const r = fundMetrics(input, false);
    expect(r.status).toBe("unavailable");
    expect(r.dpi).toBeUndefined();
  });
  it.each([
    { basis: "gross" },
    { nav: null },
    { navOn: "2025-12-31" },
    { reconciled: false },
    { asOf: "2026-02-30" },
    { nav: "NaN" },
    { nav: "9007199254740999" },
    { nav: "0.001" },
    {
      flows: [
        {
          date: "2025-01-01",
          kind: "distribution",
          currency: "USD",
          amount: "10",
        },
      ],
    },
    {
      flows: [
        {
          date: "2025-01-01",
          kind: "contribution",
          currency: "EUR",
          amount: "100",
        },
      ],
    },
    {
      flows: [
        {
          date: "2025-02-30",
          kind: "contribution",
          currency: "USD",
          amount: "100",
        },
      ],
    },
  ])("makes missing/invalid/unreconciled inputs unavailable %j", (patch) => {
    const r = fundMetrics({ ...input, ...patch } as MetricInput, true);
    expect(r.status).toBe("unavailable");
    expect(r.xirr).toBeUndefined();
    expect(r.tvpi).toBeUndefined();
  });
  it("flags known multiple roots (10% and 20%)", () =>
    expect(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: 230 },
        { date: "2027-01-01", amount: -132 },
      ]).status,
    ).toBe("ambiguous"));
  it("rejects no root, coalesces same-day flows, supports negative returns", () => {
    expect(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: -20 },
      ]).status,
    ).toBe("unavailable");
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 60 },
      { date: "2026-01-01", amount: 20 },
    ]);
    expect(r.status).toBe("available");
    if (r.status === "available") expect(r.value).toBeCloseTo(-0.2);
  });
});
