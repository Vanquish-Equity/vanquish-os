import { describe, expect, it } from "vitest";
import { fileSizeLabel, mailConfirmLabel, mailOperationLabel, mailStateLabel } from "./mail-completion-labels";

describe("mail review labels", () => {
  it("names operations and states in words", () => {
    expect(mailOperationLabel("send")).toBe("Send email");
    expect(mailStateLabel("uncertain")).toBe("Result unclear");
    expect(mailConfirmLabel("send")).toBe("Send now");
    expect(mailConfirmLabel("delete")).toBe("Delete draft");
  });
  it("falls back for unknown values", () => {
    expect(mailOperationLabel("zzz")).toBe("Gmail change");
    expect(mailStateLabel("zzz")).toBe("Unknown");
    expect(mailConfirmLabel("zzz")).toBe("Confirm");
  });
  it("formats attachment sizes", () => {
    expect(fileSizeLabel(500)).toBe("500 bytes");
    expect(fileSizeLabel(2048)).toBe("2 KB");
    expect(fileSizeLabel(1_572_864)).toBe("1.5 MB");
    expect(fileSizeLabel(-1)).toBe("");
  });
});
