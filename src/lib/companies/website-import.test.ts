import { describe, expect, it } from "vitest";
import {
  MAX_WEBSITE_IMPORT_BYTES,
  MAX_WEBSITE_IMPORT_ROWS,
  matchCompanyWebsites,
  normalizeCompanyWebsite,
  parseWebsiteImport,
  type WebsiteImportCompany,
} from "./website-import";

describe("company website normalization", () => {
  it.each([
    ["  HTTP://Coast.synthetic.test:8080/path?from=csv#section ", "https://coast.synthetic.test"],
    ["www.Hill.synthetic.test/path", "https://www.hill.synthetic.test"],
    ["bay.synthetic.test:443", "https://bay.synthetic.test"],
    ["https://Café.synthetic.test.", "https://xn--caf-dma.synthetic.test"],
  ])("keeps only the HTTPS hostname for %s", (input, expected) => {
    expect(normalizeCompanyWebsite(input)).toBe(expected);
  });

  it.each([
    "", "https://", "ftp://coast.synthetic.test", "file:///etc/hosts", "javascript:80",
    "data:text/plain,hello", "https://member:secret@coast.synthetic.test",
    "https://@coast.synthetic.test", "member@coast.synthetic.test",
    "//coast.synthetic.test", "https://coast.synthetic.test\\elsewhere",
    "coast..synthetic.test", "coast synthetic.test", "https:coast.synthetic.test",
  ])("rejects invalid or credentialed input %s", (input) => {
    expect(normalizeCompanyWebsite(input)).toBeNull();
  });
});

const companies: WebsiteImportCompany[] = [
  { id: "coast", name: "Coast Labs, Inc.", website: null },
  { id: "bay-a", name: "Bay Studio", website: null },
  { id: "bay-b", name: "BAY STUDIO", website: "https://existing.synthetic.test" },
  { id: "hill", name: "Hill Supply", website: "https://hill.synthetic.test" },
  { id: "river", name: "River Works", website: "   " },
];

function preview(csv: string) {
  const parsed = parseWebsiteImport(csv);
  if (!parsed.ok) throw new Error(parsed.message);
  return matchCompanyWebsites(parsed.rows, companies);
}

describe("company website CSV matching", () => {
  it("matches unique names, retains existing websites, and leaves ambiguous or invalid rows alone", () => {
    const rows = preview([
      "\uFEFFCompany Name,Website",
      '" coast  labs, INC. ",http://coast.synthetic.test/about',
      "Bay Studio,bay.synthetic.test",
      "Unlisted Foundry,new.synthetic.test",
      "Hill Supply,new-hill.synthetic.test",
      "River Works,https://user:secret@river.synthetic.test",
      "River Works,river.synthetic.test",
      "River Works,river.synthetic.test,extra",
    ].join("\r\n"));

    expect(rows.map(({ status }) => status)).toEqual([
      "matched", "ambiguous", "not_found", "already_set", "invalid_url", "matched", "invalid_row",
    ]);
    expect(rows[0]).toMatchObject({
      row: 1, companyId: "coast", website: "https://coast.synthetic.test",
    });
    expect(rows[4].website).toBeNull();
    expect(rows[5].companyId).toBe("river");
  });

  it("skips all conflicting proposals and keeps just one exact duplicate", () => {
    const rows = preview([
      "River Works\triver.synthetic.test/first",
      "River Works\thttp://RIVER.synthetic.test/second",
      '"Coast Labs, Inc."\tcoast.synthetic.test',
      '"Coast Labs, Inc."\tother.synthetic.test',
    ].join("\n"));
    expect(rows.map(({ status }) => status)).toEqual(["matched", "duplicate", "conflict", "conflict"]);
  });

  it("enforces the server byte and row limits", () => {
    expect(parseWebsiteImport("é".repeat(MAX_WEBSITE_IMPORT_BYTES / 2 + 1))).toMatchObject({ ok: false });
    const csv = Array.from({ length: MAX_WEBSITE_IMPORT_ROWS + 1 }, () => "Coast,coast.synthetic.test").join("\n");
    expect(parseWebsiteImport(csv)).toMatchObject({ ok: false });
  });
});
