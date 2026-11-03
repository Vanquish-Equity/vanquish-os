import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const counts = vi.hoisted(() => ({ notifications: 4, available: true }));
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: { children: React.ReactNode; prefetch?: boolean }) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/realtime/useLiveSignal", () => ({ useLiveSignal: () => {} }));
vi.mock("@/components/LocalTime", () => ({ default: () => null }));
vi.mock("@/components/UnreadCounts", () => ({
  useUnreadCounts: () => ({ notifications: counts.notifications, chat: 0, available: counts.available, refresh: vi.fn() }),
}));

import ConversationList from "./ConversationList";

// Chat hides the top bar and the sidebar has no Notifications entry, so the
// chat list is where a member on Chat reaches the Notifications page.
describe("ConversationList notifications link", () => {
  it("links to /notifications with the unread count", () => {
    counts.notifications = 4;
    counts.available = true;
    const html = renderToString(<ConversationList items={[]} me="member@synthetic.test" />).replace(/<!-- -->/g, "");
    expect(html).toContain('href="/notifications"');
    expect(html).toMatch(/data-chat-notifications-count[^>]*>4/);
  });

  it("has no badge at zero and no link while notifications are unavailable", () => {
    counts.notifications = 0;
    expect(renderToString(<ConversationList items={[]} me="m@synthetic.test" />)).not.toContain("data-chat-notifications-count");
    counts.available = false;
    expect(renderToString(<ConversationList items={[]} me="m@synthetic.test" />)).not.toContain('href="/notifications"');
  });
});
