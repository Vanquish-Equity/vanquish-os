import type { FieldDefinition, FieldValue } from "@/lib/custom-fields/model";

export const PEOPLE_FIELD_COLUMN_LIMIT = 6;
export function matchesPeopleFieldFilters(values: Map<string, FieldValue>, filters: Map<string, Set<string>>) {
  return [...filters].every(([id, options]) => {
    const value = values.get(id);
    return value?.is_set && (value.multi_value ?? (value.option_value ? [value.option_value] : []))
      .some((option) => options.has(option));
  });
}

export function peopleFieldFilters(definitions: FieldDefinition[], entries: string[]) {
  const filters = new Map<string, Set<string>>();
  for (const entry of entries.slice(0, 120)) {
    const [field, option, extra] = entry.split(":");
    const def = definitions.find((definition) => definition.id === field);
    if (extra !== undefined || !def?.filterable || !def.options.some(({ id }) => id === option)) continue;
    const choices = filters.get(field) ?? new Set<string>();
    choices.add(option);
    filters.set(field, choices);
  }
  return filters;
}
