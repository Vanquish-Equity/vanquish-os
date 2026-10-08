import { describe, expect, it, vi } from "vitest";
import { driveBatch, type DriveContext } from "./drive-engine";
import { GoogleError, type GoogleClient } from "../google/transport";

const context: DriveContext = { source: { folder_id: "folder", company_id: "company", deal_id: null }, types: [] };
const client = (work: (path: string) => unknown): GoogleClient => ({ scopes: [], request: vi.fn(async (_service, path) => work(path)) as GoogleClient["request"] });

describe("Drive incremental delivery", () => {
  it("captures a baseline before listing and detects missing files after the final page", async () => {
    const calls: string[] = [];
    const google = client(path => { calls.push(path); if (path.startsWith("/changes/start")) return { startPageToken: "baseline" }; return { files: [{ id: "new", name: "Unknown.docx", mimeType: "application/octet-stream", version: "1" }] }; });
    const first = await driveBatch(google, context, { knownIds: ["old"] });
    expect(calls[0]).toContain("/changes/start");
    expect(first.complete).toBe(false);
    expect(first.cursor.pendingRemoved).toEqual(["old"]);
    const second = await driveBatch(google, context, first.cursor);
    expect(second.files).toEqual([{ id: "old", removed: true }]);
    expect(second.cursor).toMatchObject({ changeToken: "baseline", knownIds: ["new"] });
    expect(second.complete).toBe(true);
  });

  it("archives a known file moved outside the monitored folder and excludes unrelated changes", async () => {
    const result = await driveBatch(client(() => ({ changes: [{ fileId: "known", file: { id: "known", parents: ["other"], mimeType: "text/plain" } }, { fileId: "unrelated", removed: true }], newStartPageToken: "next" })), context, { changeToken: "old", knownIds: ["known"] });
    expect(result.files).toEqual([{ id: "known", removed: true }]);
    expect(result.cursor).toEqual({ changeToken: "next", knownIds: [] });
  });

  it("retains known identities while restarting an expired cursor", async () => {
    const result = await driveBatch(client(() => { throw new GoogleError("expired_cursor", "Reset"); }), context, { changeToken: "expired", knownIds: ["known"] });
    expect(result).toEqual({ files: [], cursor: { knownIds: ["known"], mode: "full" }, complete: false });
  });

  it("does not advance the cursor after a temporary download failure", async () => {
    const google = client(path => { if (path.includes("alt=media")) throw new GoogleError("unavailable", "Retry"); return { changes: [{ fileId: "known", file: { id: "known", name: "Text.txt", parents: ["folder"], mimeType: "text/plain", version: "2", size: "5" } }], newStartPageToken: "next" }; });
    await expect(driveBatch(google, context, { changeToken: "old", knownIds: ["known"] })).rejects.toMatchObject({ code: "unavailable" });
  });
});
