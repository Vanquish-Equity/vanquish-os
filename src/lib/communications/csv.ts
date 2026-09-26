// Small CSV reader for contact lists exported from Excel, Outlook, Google
// Contacts or a CRM. Handles quoted fields, escaped quotes, CRLF, a UTF-8
// BOM and comma / semicolon / tab delimiters (Excel in Spanish locales
// saves with semicolons).

export type CsvDelimiter = "," | ";" | "\t";

export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char as CsvDelimiter] += 1;
  }
  const best = (Object.keys(counts) as CsvDelimiter[]).sort((a, b) => counts[b] - counts[a])[0];
  return counts[best] > 0 ? best : ",";
}

export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop lines that are completely empty (trailing newlines, spacer rows).
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}
