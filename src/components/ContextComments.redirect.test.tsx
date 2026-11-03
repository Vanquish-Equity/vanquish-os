// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/tasks",
  replace: vi.fn(),
  comments: [] as Record<string, unknown>[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: state.replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/UnreadCounts", () => ({ useUnreadCounts: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/realtime/useLiveSignal", () => ({ useLiveSignal: vi.fn() }));
vi.mock("@/lib/comments/context-actions", () => ({
  loadContextCommentsAction: async () => ({ comments: state.comments, members: [], conversations: [], me: "m@synthetic.test" }),
  deleteContextCommentAction: vi.fn(),
  editContextCommentAction: vi.fn(),
  postContextCommentAction: vi.fn(),
  setContextResolvedAction: vi.fn(),
  shareContextCommentAction: vi.fn(),
}));
vi.mock("@/lib/notifications/actions", () => ({ markCommentNotificationsReadAction: vi.fn(async () => {}) }));

import ContextComments from "./ContextComments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "11111111-1111-1111-1111-111111111111";
const comment = (target: string) => ({
  id: ID, parent_id: null, target_key: target, target_label: "x", author_email: "a@synthetic.test", body: "hi",
  created_at: "2026-01-01T00:00:00Z", edited_at: null, deleted_at: null, resolved_at: null, visible_to: null,
  value_snapshot: null, mentions: [] as never[],
});

describe("a #comment-<id> link that opens the wrong tab", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/([^\w-])/g, "\\$1") });
    Element.prototype.scrollIntoView = vi.fn();
    state.replace.mockClear();
    document.body.innerHTML = '<main id="m"></main>';
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  async function open(url: string, comments: ReturnType<typeof comment>[]) {
    window.history.replaceState(null, "", url);
    state.pathname = url.split(/[?#]/)[0];
    state.comments = comments;
    await act(async () => {
      root.render(createElement(ContextComments));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("replaces to the tab holding the anchor when it is missing here", async () => {
    await open(`/tasks#comment-${ID}`, [comment("task:t1")]);
    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith(`/tasks?tab=all#comment-${ID}`);
  });

  it("does not navigate when the anchor exists on the current tab", async () => {
    document.body.insertAdjacentHTML("beforeend", '<div data-comment-anchor="task:t1"></div>');
    await open(`/tasks#comment-${ID}`, [comment("task:t1")]);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("does not navigate for a comment that is not in the readable list", async () => {
    await open(`/tasks#comment-${ID}`, []);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("does not loop: on the target tab it stays even if the anchor is still missing", async () => {
    await open(`/tasks?tab=all#comment-${ID}`, [comment("task:t1")]);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("finds a Dashboard-anchored comment from /home", async () => {
    await open(`/home#comment-${ID}`, [comment("stat:1")]);
    expect(state.replace).toHaveBeenCalledWith(`/home?tab=dashboard#comment-${ID}`);
  });
});
