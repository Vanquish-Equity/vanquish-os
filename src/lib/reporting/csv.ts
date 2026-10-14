export const EXPORT_LIMIT = 5000;
export const BATCH_SIZE = 250;
export type ExportResource = "deals" | "funds" | "documents";
export type ExportRow = {
  id: string;
  name: string;
  currency: string;
  amount: string | null;
  created_at: string | null;
};
// Quote all cells; a leading apostrophe neutralizes spreadsheet evaluation.
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csvRows(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function exportCsv(
  resource: ExportResource,
  rows: ExportRow[],
  capped: boolean,
) {
  return csvRows([
    [
      "resource",
      resource,
      "timezone",
      "UTC",
      "currency",
      resource === "funds" ? "per row (ISO 4217)" : "N/A",
    ],
    [
      "consistency",
      "Concurrent export; not an accounting snapshot",
      "row cap",
      EXPORT_LIMIT,
      "cap reached",
      capped,
    ],
    [
      "id",
      "name",
      "currency (ISO 4217 or N/A)",
      "target amount (fund currency)",
      "created_at (UTC)",
    ],
    ...rows.map((r) => [r.id, r.name, r.currency, r.amount, r.created_at]),
  ]);
}
export async function collectExport(
  fetchBatch: (after: string | null) => Promise<ExportRow[]>,
) {
  const rows: ExportRow[] = [];
  let after: string | null = null;
  for (let batch = 0; batch < EXPORT_LIMIT / BATCH_SIZE; batch++) {
    const page = await fetchBatch(after); // Server RPC rechecks current permissions + RLS every batch.
    if (page.length > BATCH_SIZE) throw Error("Invalid export batch");
    for (const row of page) {
      if (after !== null && row.id <= after)
        throw Error("Unstable export cursor");
      rows.push(row);
      after = row.id;
    }
    if (page.length < BATCH_SIZE) return { rows, capped: false };
  }
  return { rows, capped: true };
}
