import { expect, it } from "vitest";
import { cityArcs, groupCompanyCities, projectFootprintPoint, type MapPerspective } from "./company-map";
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
  const perspectives: MapPerspective[] = ["angled", "overhead", "reverse"];
  const paths = perspectives.map((perspective) => {
    const [{ key, path }] = cityArcs(cities, perspective);
    const [from, to] = key.split("/").map((label) => cities.find((city) => city.label === label)!);
    expect(path.startsWith(`M${projectFootprintPoint(...from.point, perspective).join(",")} C`)).toBe(true);
    expect(path.endsWith(` ${projectFootprintPoint(...to.point, perspective).join(",")}`)).toBe(true);
    return path;
  });
  expect(new Set(paths).size).toBe(3);
});
