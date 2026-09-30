import { describe, expect, it } from "vitest";
import { insertRecipient, recipientFragment, suggestRecipients } from "./contact-suggestions";

const contacts = [
  { name: "Pedro Beirute", email: "pbp@example.com" },
  { name: "Pedro duplicate", email: "PBP@example.com" },
  { name: "María Salas", email: "maria@example.com" },
  { name: "No address", email: null },
];
describe("recipient suggestions", () => {
  it("matches names without accents and emails, with one option per address", () => {
    expect(suggestRecipients(contacts, "pedro", 5)).toEqual([contacts[0]]);
    expect(suggestRecipients(contacts, "maria", 5)).toEqual([contacts[2]]);
    expect(suggestRecipients(contacts, "pbp@", 4)).toEqual([contacts[0]]);
    expect(suggestRecipients(contacts, "", 0)).toEqual([]);
  });
  it("preserves quoted names, other recipients and semicolon separators", () => {
    const value = '"Doe, John" <john@example.com>; pedro; next@example.com';
    const caret = value.indexOf("pedro") + 5;
    expect(recipientFragment(value, caret).query).toBe("pedro");
    expect(insertRecipient(value, caret, "pbp@example.com").value).toBe('"Doe, John" <john@example.com>; pbp@example.com; next@example.com');
  });
  it("replaces the token at the caret, preserving text after it", () => {
    expect(insertRecipient("pedro, maria@example.com", 3, "pbp@example.com").value).toBe("pbp@example.com, maria@example.com");
    expect(insertRecipient("pedro", 5, "pbp@example.com")).toEqual({ value: "pbp@example.com, ", caret: 17 });
  });
  it("does not suggest addresses already selected in the same field", () => {
    const value = "pbp@example.com, pedro";
    expect(suggestRecipients(contacts, value, value.length)).toEqual([]);
    expect(suggestRecipients(contacts, "pbp@example.com", 15)).toEqual([]);
  });
});
