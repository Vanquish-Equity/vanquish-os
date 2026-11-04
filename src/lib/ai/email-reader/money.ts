import type { Amount } from "./types";

const SCALE: Record<string, number> = {
  k: 1e3, mil: 1e3, m: 1e6, mm: 1e6, million: 1e6, millions: 1e6, millon: 1e6, millones: 1e6,
  b: 1e9, billion: 1e9, billions: 1e9,
};
const CURRENCY: Record<string, string> = { "$": "USD", "us$": "USD", usd: "USD", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP" };

// Every money amount that a text states, e.g. "$15M", "USD 1.5 million",
// "15 millones". Used to check that a model's number is really in its quote.
export function parseAmounts(text: string): Amount[] {
  const found: Amount[] = [];
  const pattern = /(us\$|\$|usd|€|eur|£|gbp)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(millones|millions|million|millon|billions|billion|mil|mm|k|m|b)?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const currency = match[1] ? CURRENCY[match[1].toLowerCase()] : undefined;
    const scale = match[3] ? SCALE[match[3].toLowerCase()] : undefined;
    if (!currency && !scale) continue; // a bare number is not an amount
    const value = Number(match[2].replace(/,/g, "")) * (scale ?? 1);
    if (Number.isFinite(value) && value > 0) found.push({ currency: currency ?? "USD", value: Math.round(value) });
  }
  return found;
}
