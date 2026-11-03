import type { IconName } from "@/components/NavIcon";

// What the collapsed sidebar rail draws: one entry per sidebar section. These
// helpers are fed by the same `sections` and quick links the expanded sidebar
// renders, so the two can never list different pages.

export type RailItem = { href: string; label: string; icon: IconName; badge?: "chat" | "notifications"; extra?: boolean };
export type RailSection<T extends RailItem> = { key: string; label: string; items: T[] };

// A direct link (one page) or a section whose pages open in a flyout.
export type RailEntry<T extends RailItem> =
  | { kind: "link"; key: string; label: string; icon: IconName; item: T }
  | { kind: "section"; key: string; label: string; icon: IconName; items: T[] };

export const isActive = (activeHref: string, href: string) =>
  activeHref === href || (href !== "/boards" && activeHref.startsWith(href + "/"));

const SECTION_ICONS: Record<string, IconName> = {
  crm: "section_crm",
  work: "section_work",
  boards: "boards",
  fund: "section_fund",
  system: "section_system",
};

export function railEntries<T extends RailItem>(quick: T[], sections: RailSection<T>[]) {
  const link = (item: T): RailEntry<T> => ({ kind: "link", key: item.href, label: item.label, icon: item.icon, item });
  return {
    quick: quick.map(link),
    sections: sections.map((section): RailEntry<T> => {
      const icon = SECTION_ICONS[section.key] ?? section.items[0].icon;
      // One visible page: no flyout needed. The icon stays the section's icon
      // and the name is "Boards: CRM boards" (section first); a click goes
      // straight to the page.
      if (section.items.length === 1) {
        const item = section.items[0];
        return { kind: "link", key: item.href, label: `${section.label}: ${item.label}`, icon, item };
      }
      return { kind: "section", key: section.key, label: section.label, icon, items: section.items };
    }),
  };
}

export function entryHoldsActive<T extends RailItem>(entry: RailEntry<T>, activeHref: string) {
  const items = entry.kind === "link" ? [entry.item] : entry.items;
  return items.some((item) => !item.extra && isActive(activeHref, item.href));
}
