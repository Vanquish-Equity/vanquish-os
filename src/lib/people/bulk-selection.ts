export const PEOPLE_SELECTION_LIMIT = 100;

export function validPeopleSelection(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= PEOPLE_SELECTION_LIMIT &&
    ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) &&
    new Set(ids.map((id: string) => id.toLowerCase())).size === ids.length;
}
