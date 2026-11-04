import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { companyCityHref, groupCompanyCities, MAP_COMPANY_LIMIT, type CompanyFootprintData } from "./company-map";

export async function loadCompanyFootprint(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CompanyFootprintData | null> {
  const { data, count, error } = await supabase.from("companies")
    .select("location", { count: "exact" }).is("deleted_at", null).not("location", "is", null)
    .order("id").limit(MAP_COMPANY_LIMIT);
  if (error || !data) return null;
  const cities = groupCompanyCities(data);
  return {
    cities: cities.map((city) => ({ label: city.label, point: city.point, count: city.count, href: companyCityHref(city) })),
    unmapped: data.length - cities.reduce((total, city) => total + city.count, 0),
    partial: (count ?? 0) > data.length,
  };
}
