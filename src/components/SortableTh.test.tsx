import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import SortableTh from "./SortableTh";
import type { ListSort } from "@/lib/list-sort";

function header(sort: ListSort<"name" | "company">) {
  return renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <SortableTh label="Name" sortKey="name" sort={sort} baseHref="/people?view=lps&group=g1" />
          <SortableTh label="Company" sortKey="company" sort={sort} baseHref="/people?view=lps&group=g1" />
          <th>Last email</th>
        </tr>
      </thead>
    </table>,
  );
}

describe("SortableTh", () => {
  it("sets no aria-sort anywhere when nothing is sorted, and links to ascending", () => {
    const html = header(null);
    expect(html).not.toContain("aria-sort");
    expect(html).toContain('href="/people?view=lps&amp;group=g1&amp;sort=name&amp;dir=asc"');
    expect(html).toContain('aria-label="Sort by Name, ascending"');
  });

  it("marks only the active column and offers the next step", () => {
    const html = header({ key: "name", dir: "asc" });
    expect(html.match(/aria-sort/g)).toHaveLength(1);
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("sort=name&amp;dir=desc");
    expect(html).toContain("A–Z");
    const desc = header({ key: "name", dir: "desc" });
    expect(desc).toContain('aria-sort="descending"');
    expect(desc).toContain("Z–A");
    expect(desc).toContain('href="/people?view=lps&amp;group=g1"');
    expect(desc).toContain('aria-label="Stop sorting by Name"');
  });

  it("leaves plain headers without a link or aria-sort", () => {
    const html = header({ key: "company", dir: "asc" });
    expect(html).toContain("<th>Last email</th>");
  });
});
