import { US_CITY_POINTS } from "./us-map-data";

type Point = readonly [number, number];
type City = { label: string; point: Point; count: number; demo: number; locations: string[] };
const known = new Map(Object.keys(US_CITY_POINTS).map((city) => [city.toLowerCase(), city]));
export const MAP_COMPANY_LIMIT = 1000;

export function groupCompanyCities(rows: { location: string | null }[]) {
  const cities = new Map<string, City>();
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

// A single perspective transform keeps borders and dots on the same plane.
// The western edge is closer to the viewer; the plane recedes to the right.
export function projectFootprintPoint(x: number, y: number): Point {
  const dx = x - 500, dy = y - 260;
  const depth = 1 + .00069 * dx - .00070 * dy;
  return [480 + (.90 * dx + .43 * dy) / depth, 230 + (-.21 * dx + .59 * dy) / depth];
}

// The bundled SVG geometry contains only absolute M/L coordinates and Z.
export function projectFootprintPath(path: string): string {
  return path.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x, y) =>
    projectFootprintPoint(Number(x), Number(y)).map((value) => value.toFixed(1)).join(","));
}

export function cityArcs(cities: City[]) {
  if (cities.length < 2) return [];
  const edges: { from: City; to: City; distance: number }[] = [];
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
  return [...paths].map(({ from, to }) => {
    const [x, y] = projectFootprintPoint(...from.point), [u, v] = projectFootprintPoint(...to.point);
    const lift = Math.min(91, 8 + Math.hypot(u - x, v - y) * .15);
    return {
      key: `${from.label}/${to.label}`,
      path: `M${x},${y} C${x+(u-x)*.24},${Math.min(y,v)-lift} ${x+(u-x)*.76},${Math.min(y,v)-lift} ${u},${v}`,
    };
  });
}
