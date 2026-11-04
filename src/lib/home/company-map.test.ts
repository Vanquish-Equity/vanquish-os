import { expect, it } from "vitest";
import { cityArcs, groupCompanyCities } from "./company-map";
import { DEFAULT_MAP_CAMERA, MAP_ANGLES, mapLens, renderMapArc } from "./map-camera";
import { US_CITY_POINTS } from "./us-map-data";
import { US_CITIES } from "@/lib/companies/locations";

it("groups real and demo variants without mapping unsupported or foreign cities", () => {
  const result = groupCompanyCities([
    { location: "Miami, FL · Demo" }, { location: "miami,fl" },
    { location: "San José, Costa Rica" }, { location: "Unrecognized, TX" },
    { location: null }, { location: "New York, NY" },
  ]);
  expect(result.map(({ label, count, demo }) => ({ label, count, demo }))).toEqual([
    { label: "Miami, FL", count: 2, demo: 1 }, { label: "New York, NY", count: 1, demo: 0 },
  ]);
  expect(result[0].locations).toEqual(["Miami, FL · Demo", "miami,fl"]);
  expect(cityArcs(result)).toHaveLength(1);
});

it("plots every suggested US location and limits arcs to a sparse connected network", () => {
  expect(Object.keys(US_CITY_POINTS).sort()).toEqual([...US_CITIES].sort());
  const cities = groupCompanyCities(US_CITIES.map((location) => ({ location })));
  const arcs = cityArcs(cities);
  expect(arcs.length).toBeLessThanOrEqual(cities.length + 2);
  expect(new Set(arcs.flatMap(({ key }) => key.split("/"))).size).toBe(cities.length);
});

it("keeps arcs connected to the same cities in every perspective", () => {
  const cities = groupCompanyCities([{ location: "Seattle, WA" }, { location: "Miami, FL" }]);
  const [{ from, to }] = cityArcs(cities);
  const paths = Object.values(MAP_ANGLES).map((angles) => {
    const { project } = mapLens({ ...DEFAULT_MAP_CAMERA, ...angles });
    const format = (point: readonly number[]) => point.map((n) => n.toFixed(1)).join(",");
    const path = renderMapArc(from, to, project);
    expect(path.startsWith(`M${format(project(from))}L`)).toBe(true);
    expect(path.endsWith(`L${format(project(to))}`)).toBe(true);
    return path;
  });
  expect(new Set(paths).size).toBe(3);
});
