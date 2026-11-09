import {it,expect} from 'vitest';
import {classifyDocument} from './classify';
const types=[{id:'nda',category_id:'legal',name:'Non disclosure agreement',code:'nda'},{id:'deck',category_id:'finance',name:'Pitch deck',code:'pitch_deck'}];
it('proposes metadata only with unambiguous type and valid date evidence',()=>{expect(classifyDocument('NDA_2026-10-01.pdf','Non disclosure agreement',types)).toMatchObject({typeId:'nda',date:'2026-10-01',confidence:'rule'});expect(classifyDocument('unknown.pdf','Pitch deck and non disclosure agreement 2026-02-31',types)).toMatchObject({typeId:null,date:null,confidence:'review'});});
it('does not infer execution or signing from a filename',()=>{expect(classifyDocument('signed_nda.pdf','',types).status).toBe('RECEIVED');});

const financialTypes = [
  { id: "history", category_id: "finance", name: "Renamed financial archive", code: "historical_financials" },
  { id: "model", category_id: "finance", name: "Financial Model", code: "financial_model" },
];

it.each([
  ["Example_Financial-Report_2026-10-01.pdf", ""],
  ["Financial_Statements.pdf", ""],
  ["P&L.pdf", ""],
  ["unknown.pdf", "P &\nL"],
  ["unknown.pdf", "Profit and loss"],
  ["unknown.pdf", "Balance sheet"],
  ["unknown.pdf", "Income statement"],
  ["Quarterly reports.pdf", ""],
  ["Informe-financiero.pdf", ""],
  ["unknown.pdf", "ESTADOS\n FINANCIEROS"],
])("identifies Historical Financials by seeded code in %s %s", (name, text) => {
  expect(classifyDocument(name, text, financialTypes)).toMatchObject({
    typeId: "history", categoryId: "finance", confidence: "rule",
  });
});

it.each([
  ["Balance sheet.pdf", "Financial model"],
  ["Financial model.pdf", "Adjunto los estados financieros."],
])("leaves the type unset when financial history and a model both match", (name, text) => {
  expect(classifyDocument(name, text, financialTypes)).toMatchObject({
    typeId: null, categoryId: null, confidence: "review",
  });
});

it.each([
  ["Balance spreadsheet.pdf", "Quarterly forecast"],
  ["unknown.pdf", "Informe comercial con estados de envío."],
  ["unknown.pdf", "Nonfinancial reporting / CP&Lateral"],
])("does not infer financial history from similar but unrelated phrases", (name, text) => {
  expect(classifyDocument(name, text, financialTypes)).toMatchObject({
    typeId: null, categoryId: null, confidence: "review",
  });
});

it("does not invent a financial type if the seeded type is not available", () => {
  expect(classifyDocument("Financial report.pdf", "", financialTypes.slice(1))).toMatchObject({
    typeId: null, categoryId: null, confidence: "review",
  });
});

it.each([
  { id: "npa", name: "Note Purchase Agreement", code: "note_purchase_agreement" },
  { id: "safe", name: "Simple Agreement for Future Equity", code: "safe" },
])("keeps $id when its body mentions financial statements far from the title", (contract) => {
  const body = `${contract.name.toUpperCase()}. ${"Whereas the parties agree. ".repeat(120)} The company's financial statements and balance sheet fairly present its position.`;
  expect(classifyDocument(`${contract.name}.pdf`, body, [{ ...contract, category_id: "legal" }, ...financialTypes]))
    .toMatchObject({ typeId: contract.id, confidence: "rule" });
});

it("still recognizes a report whose title is at the top of its text", () => {
  expect(classifyDocument("scan_0042.pdf", "Q3 Financial Report\nRevenue and costs.", financialTypes))
    .toMatchObject({ typeId: "history", confidence: "rule" });
});
