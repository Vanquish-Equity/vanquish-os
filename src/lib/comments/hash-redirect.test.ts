import { describe, expect, it } from "vitest";
import { hashRedirectHref } from "./context";

const tasks = { page: "tasks", companyId: null, dealId: null };
const home = { page: "home", companyId: null, dealId: null };
const comments = [
  { id: "c-task", target_key: "task:t1" },
  { id: "c-review", target_key: "review:r1" },
  { id: "c-act", target_key: "interaction:i1" },
  { id: "c-page", target_key: "page" },
  { id: "c-stat", target_key: "stat:2" },
  { id: "c-today", target_key: "home-tasks" },
];
const at = (pathname: string, search = "") => ({ pathname, search });

describe("hashRedirectHref", () => {
  it("moves a task comment opened on Mine to All, keeping the hash", () => {
    expect(hashRedirectHref(tasks, comments, "c-task", at("/tasks"))).toBe("/tasks?tab=all#comment-c-task");
  });

  it("moves review and activity comments to their tabs", () => {
    expect(hashRedirectHref(tasks, comments, "c-review", at("/tasks"))).toBe("/tasks?tab=review#comment-c-review");
    expect(hashRedirectHref(tasks, comments, "c-act", at("/tasks", "?tab=all"))).toBe("/tasks?tab=activity#comment-c-act");
  });

  it("moves a Dashboard-anchored comment from Today to the Dashboard", () => {
    expect(hashRedirectHref(home, comments, "c-stat", at("/home"))).toBe("/home?tab=dashboard#comment-c-stat");
  });

  it("does not navigate when already on the right tab (no loop)", () => {
    expect(hashRedirectHref(tasks, comments, "c-task", at("/tasks", "?tab=all"))).toBeNull();
    expect(hashRedirectHref(home, comments, "c-stat", at("/home", "?tab=dashboard"))).toBeNull();
  });

  it("does not navigate for links without a tab hint, or for the default tab", () => {
    expect(hashRedirectHref(tasks, comments, "c-page", at("/tasks", "?tab=review"))).toBeNull();
    expect(hashRedirectHref(home, comments, "c-today", at("/home", "?tab=reports"))).toBeNull();
  });

  it("does not navigate for a comment the member cannot read (not in the list)", () => {
    expect(hashRedirectHref(tasks, comments, "unknown", at("/tasks"))).toBeNull();
    expect(hashRedirectHref(tasks, [{ id: "x", target_key: null }], "x", at("/tasks"))).toBeNull();
  });
});
