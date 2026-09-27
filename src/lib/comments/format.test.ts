import { describe, expect, it } from "vitest";
import { buildThreads, commentHref, taskTitleFromComment, visibleCommentCount, type CommentItem } from "./format";

const base = { authorEmail: "a@x", body: "hi", editedAt: null, deletedAt: null, mentions: [], tasks: [] };
const c = (id: string, at: string, extra: Partial<CommentItem> = {}): CommentItem => ({
  ...base,
  id,
  parentId: null,
  createdAt: at,
  ...extra,
});

describe("buildThreads", () => {
  it("orders threads and replies oldest first", () => {
    const threads = buildThreads([
      c("r2", "2026-01-03", { parentId: "t1" }),
      c("t2", "2026-01-04"),
      c("t1", "2026-01-01"),
      c("r1", "2026-01-02", { parentId: "t1" }),
    ]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ["t1", ["r1", "r2"]],
      ["t2", []],
    ]);
  });

  it("keeps a deleted root only while it has live replies", () => {
    const gone = { deletedAt: "2026-01-05", body: "" };
    const threads = buildThreads([
      c("t1", "2026-01-01", gone),
      c("r1", "2026-01-02", { parentId: "t1" }),
      c("t2", "2026-01-03", gone),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["t1"]);
    expect(visibleCommentCount(threads)).toBe(1);
  });

  it("keeps a deleted reply only when later replies follow it", () => {
    const gone = { deletedAt: "2026-01-09", body: "" };
    const threads = buildThreads([
      c("t1", "2026-01-01"),
      c("r1", "2026-01-02", { parentId: "t1", ...gone }),
      c("r2", "2026-01-03", { parentId: "t1" }),
      c("r3", "2026-01-04", { parentId: "t1", ...gone }),
    ]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("links and titles", () => {
  it("links to the comment on its company or deal page", () => {
    expect(commentHref("co", null, "cm")).toBe("/companies/co#comment-cm");
    expect(commentHref("co", "de", "cm")).toBe("/companies/co/deals/de#comment-cm");
  });

  it("derives a one-line task title", () => {
    expect(taskTitleFromComment("  Send\nthe   memo ")).toBe("Send the memo");
    expect(taskTitleFromComment("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
