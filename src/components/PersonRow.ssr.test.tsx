import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/people/actions", () => ({ setPotentialLpAction: vi.fn(), updateContactAction: vi.fn() }));
vi.mock("@/lib/people-groups/actions", () => ({ createPeopleGroup: vi.fn(), setPersonGroupMembership: vi.fn() }));
vi.mock("@/components/custom-fields/CustomFieldsRecord", () => ({ default: () => null }));

import PersonContactActions from "./PersonContactActions";
import PersonRow, { PeopleGroupsProvider } from "./PersonRow";

// Node environment: no `document`, like the server render of /people. The
// menu and dialog portal to document.body, so they must only exist after a
// user action.
describe("PersonRow on the server", () => {
  it("renders the row, the Classify button and no menu without touching document", () => {
    let html = "";
    expect(() => {
      html = renderToString(
        <PeopleGroupsProvider groups={[{ id: "g1", name: "Friends" }]}>
          <table>
            <tbody>
              <PersonRow
                personId="p1"
                name="Ada"
                email="ada@example.test"
                isPotentialLp={false}
                profileHref="/people/p1"
                memberGroupIds={[]}
              >
                <td>
                  <PersonContactActions personId="p1" name="Ada" email="ada@example.test" isPotentialLp={false} />
                </td>
              </PersonRow>
            </tbody>
          </table>
        </PeopleGroupsProvider>,
      );
    }).not.toThrow();
    expect(html).toContain("Classify");
    expect(html).toContain("cursor-pointer");
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("Mark potential LP");
  });
});
