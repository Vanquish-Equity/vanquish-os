import { US_CITY_POINTS } from "./us-map-data";

type Point = readonly [number, number];
type MapPoint = { label: string; point: Point };
type CompanyMapCity = MapPoint & { count: number; demo: number; locations: string[] };
export type CompanyFootprintCity = MapPoint & { count: number; href: string };
export type CompanyFootprintData = { cities: CompanyFootprintCity[]; unmapped: number; partial: boolean };
const known = new Map(Object.keys(US_CITY_POINTS).map((city) => [city.toLowerCase(), city]));
export const MAP_COMPANY_LIMIT = 1000;

export function groupCompanyCities(rows: { location: string | null }[]) {
  const cities = new Map<string, CompanyMapCity>();
  for (const { location } of rows) {
    if (!location) continue;
    const demo = /\s*·\s*demo\s*$/i.test(location);
    const key = location.replace(/\s*·\s*demo\s*$/i, "").trim().replace(/\s*,\s*/g, ", ").toLowerCase();
    const label = known.get(key);
    if (!label) continue;
    const city = cities.get(label) ?? { label, point: US_CITY_POINTS[label], count: 0, demo: 0, locations: [] };
    city.count++;
    if (demo) city.demo++;
    if (!city.locations.includes(location)) city.locations.push(location);
    cities.set(label, city);
  }
  return [...cities.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function cityArcs(cities: readonly MapPoint[]) {
  if (cities.length < 2) return [];
  const edges: { from: MapPoint; to: MapPoint; distance: number }[] = [];
  for (const [i, from] of cities.entries()) for (const to of cities.slice(i + 1)) {
    edges.push({ from, to, distance: Math.hypot(from.point[0] - to.point[0], from.point[1] - to.point[1]) });
  }
  const groups = new Map(cities.map((city) => [city, city]));
  const paths = new Set<(typeof edges)[number]>();
  edges.sort((a, b) => a.distance - b.distance);
  for (const edge of edges) {
    const a = groups.get(edge.from), b = groups.get(edge.to);
    if (a === b) continue;
    paths.add(edge);
    for (const [city, group] of groups) if (group === b) groups.set(city, a!);
  }
  // A few long routes create the visual sweep without drawing a full mesh.
  if (cities.length > 2) for (const edge of edges.slice(-Math.min(3, cities.length - 2))) paths.add(edge);
  return [...paths].map(({ from, to }) => ({
    key: `${from.label}/${to.label}`,
    from: from.point,
    to: to.point,
  }));
}

export function companyCityHref({ locations }: Pick<CompanyMapCity, "locations">) {
  return `/companies?${new URLSearchParams({ "match-location": JSON.stringify(locations.slice(0, 50)) })}`;
}
