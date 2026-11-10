export const FOUNDER_FIELDS = [
  { key: "city", label: "City", max: 120 },
  { key: "country", label: "Country", max: 120 },
  { key: "origin", label: "Origin", max: 160 },
] as const;

export type FounderField = (typeof FOUNDER_FIELDS)[number]["key"];
export type FounderProfile = Record<FounderField, string | null>;
export const EMPTY_FOUNDER_PROFILE: FounderProfile = { city: null, country: null, origin: null };

export function cleanFounderProfile(input: unknown): FounderProfile | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !FOUNDER_FIELDS.some((field) => field.key === key))) return null;
  const result = { ...EMPTY_FOUNDER_PROFILE };
  for (const { key, max } of FOUNDER_FIELDS) {
    if (value[key] !== null && value[key] !== undefined && typeof value[key] !== "string") return null;
    const text = typeof value[key] === "string" ? value[key].trim() : "";
    if (Array.from(text).length > max) return null;
    result[key] = text || null;
  }
  return result;
}
