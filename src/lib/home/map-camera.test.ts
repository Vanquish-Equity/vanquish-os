import { expect, it } from "vitest";
import { DEFAULT_MAP_CAMERA, MAP_CENTER, mapLens, moveMapCamera, type MapPoint } from "./map-camera";

function expectPoint(actual: MapPoint, expected: MapPoint) {
  expect(actual[0]).toBeCloseTo(expected[0], 7);
  expect(actual[1]).toBeCloseTo(expected[1], 7);
}

it("keeps the point grabbed on the ground under the pointer as the camera pans", () => {
  const start: MapPoint = [350, 185], end: MapPoint = [426, 235];
  const view = { ...DEFAULT_MAP_CAMERA, heading: -31, tilt: 59, zoom: 2 };
  const grabbed = mapLens(view).groundAt(start);
  const moved = moveMapCamera(view, {}, start, end);
  expect(moved.center).not.toEqual(view.center);
  expectPoint(mapLens(moved).project(grabbed), end);
});

it("keeps the pinch midpoint anchored as the camera zooms and turns", () => {
  const start: MapPoint = [540, 200], end: MapPoint = [560, 215];
  const view = DEFAULT_MAP_CAMERA;
  const grabbed = mapLens(view).groundAt(start);
  const moved = moveMapCamera(view, { scale: 1.6, heading: 24 }, start, end);
  expect(moved.zoom).toBe(1.6);
  expect(moved.heading).toBe(40);
  expectPoint(mapLens(moved).project(grabbed), end);
});

it("orbits around a fixed ground center and reprojects altitude with tilt", () => {
  const view = DEFAULT_MAP_CAMERA;
  const ground: MapPoint = [600, 315];
  const turned = moveMapCamera(view, { heading: 90, tilt: 100 });
  expect(turned.tilt).toBe(62);
  expectPoint(turned.center, view.center);
  const lens = mapLens(turned);
  expectPoint(lens.project(view.center), MAP_CENTER);
  expect(lens.project(ground)).not.toEqual(mapLens(view).project(ground));
  expect(lens.project(ground, 80)[1]).toBeLessThan(lens.project(ground)[1]);
});
