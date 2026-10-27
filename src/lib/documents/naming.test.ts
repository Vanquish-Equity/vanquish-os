import { describe, expect, it } from "vitest";
import { formatCanonicalDocumentName } from "./naming";

describe("formatCanonicalDocumentName", () => {
  it("formats target financial statements with a period label", () => {
    expect(
      formatCanonicalDocumentName({
        entityRole: "TARGET",
        entityName: "Synthetic Company",
        category: "FIN",
        documentType: "Financial Statements",
        periodLabel: "2026-Q2",
        docStatus: "EXECUTED",
        extension: "pdf",
      })
    ).toBe("TARGET_SyntheticCompany_FIN_FinancialStatements_2026-Q2_EXECUTED.pdf");
  });

  it("includes investor identity for LP documents", () => {
    expect(
      formatCanonicalDocumentName({
        entityRole: "SPV",
        entityName: "Vanquish Synthetic Company",
        category: "LP",
        documentType: "Subscription Agreement",
        investorName: "Smith Family Office",
        documentDate: "2026-09-20",
        docStatus: "EXECUTED",
        extension: ".pdf",
      })
    ).toBe(
      "SPV_VanquishSyntheticCompany_LP_SubscriptionAgreement_SmithFamilyOffice_2026-09-20_EXECUTED.pdf"
    );
  });

  it("falls back to version when status is absent", () => {
    expect(
      formatCanonicalDocumentName({
        entityRole: "target",
        entityName: "Synthetic Co, Inc.",
        category: "legal",
        documentType: "Side Letter",
        versionNumber: 2,
        extension: "pdf",
      })
    ).toBe("TARGET_SyntheticCoInc_LEGAL_SideLetter_Undated_v2.pdf");
  });
});
