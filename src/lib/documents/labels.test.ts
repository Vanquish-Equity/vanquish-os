import { describe, expect, it } from "vitest";
import { documentStatusLabel, extractionLabel, shortFolderLabel } from "./labels";

describe("document labels", () => {
  it("reads in plain words", () => {
    expect(documentStatusLabel("pending")).toBe("Waiting for your review");
    expect(documentStatusLabel(null)).toBe("Not reviewed yet");
    expect(documentStatusLabel("weird")).toBe("In review");
    expect(extractionLabel("needs_review")).toBe("Text needs a check");
    expect(extractionLabel(undefined)).toBe("No text read");
  });
  it("shortens folder codes", () => {
    expect(shortFolderLabel("1AbCdEfGhIjKlMnOp")).toBe("Folder ending in KlMnOp");
    expect(shortFolderLabel("abc")).toBe("Folder abc");
  });
});
