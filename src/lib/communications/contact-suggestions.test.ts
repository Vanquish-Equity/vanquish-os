import { describe, expect, it } from "vitest";
import { insertRecipient, recipientFragment, suggestRecipients } from "./contact-suggestions";

const contacts = [
  { name: "Delta Example", email: "dlt@example.com" },
  { name: "Delta duplicate", email: "DLT@example.com" },
  { name: "Sofía Example", email: "sofia@example.com" },
  { name: "No address", email: null },
];
describe("recipient suggestions", () => {
  it("matches names without accents and emails, with one option per address", () => {
    expect(suggestRecipients(contacts, "delta", 5)).toEqual([contacts[0]]);
    expect(suggestRecipients(contacts, "sofia", 5)).toEqual([contacts[2]]);
    expect(suggestRecipients(contacts, "dlt@", 4)).toEqual([contacts[0]]);
    expect(suggestRecipients(contacts, "", 0)).toEqual([]);
  });
  it("preserves quoted names, other recipients and semicolon separators", () => {
    const value = '"Doe, John" <john@example.com>; delta; next@example.com';
    const caret = value.indexOf("delta") + 5;
    expect(recipientFragment(value, caret).query).toBe("delta");
    expect(insertRecipient(value, caret, "dlt@example.com").value).toBe('"Doe, John" <john@example.com>; dlt@example.com; next@example.com');
  });
  it("replaces the token at the caret, preserving text after it", () => {
    expect(insertRecipient("delta, sofia@example.com", 3, "dlt@example.com").value).toBe("dlt@example.com, sofia@example.com");
    expect(insertRecipient("delta", 5, "dlt@example.com")).toEqual({ value: "dlt@example.com, ", caret: 17 });
  });
  it("does not suggest addresses already selected in the same field", () => {
    const value = "dlt@example.com, delta";
    expect(suggestRecipients(contacts, value, value.length)).toEqual([]);
    expect(suggestRecipients(contacts, "dlt@example.com", 15)).toEqual([]);
  });
});
