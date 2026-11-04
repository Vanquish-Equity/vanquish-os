export type MapPoint = readonly [number, number];
export type MapCamera = { center: MapPoint; heading: number; tilt: number; zoom: number };

export const MAP_VIEW = { left: 34, top: 80, width: 804, height: 310 };
export const MAP_CENTER: MapPoint = [MAP_VIEW.left + MAP_VIEW.width / 2, MAP_VIEW.top + MAP_VIEW.height / 2];
export const MAP_ANGLES = {
  angled: { heading: 16, tilt: 48 },
  overhead: { heading: 0, tilt: 0 },
  reverse: { heading: -23, tilt: 49 },
};
export const DEFAULT_MAP_CAMERA: MapCamera = { center: [484, 267], zoom: 1, ...MAP_ANGLES.angled };
export const MAX_MAP_ZOOM = 4;

const radians = Math.PI / 180;
const distance = 1200;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function mapLens({ center: [cx, cy], heading, tilt, zoom }: MapCamera) {
  const c = Math.cos(heading * radians), s = Math.sin(heading * radians);
  const flat = Math.cos(tilt * radians), steep = Math.sin(tilt * radians);
  const focal = distance * 1.04 * zoom;
  const [sx, sy] = MAP_CENTER;

  // Ground coordinates stay put. Bearing rotates the camera basis; tilt and
  // altitude change depth before the pinhole projection onto the fixed viewport.
  function project([x, y]: MapPoint, height = 0): MapPoint {
    const dx = x - cx, dy = y - cy;
    const across = c * dx + s * dy, along = -s * dx + c * dy;
    const depth = distance - along * steep - height * flat;
    return [sx + focal * across / depth, sy + focal * (along * flat - height * steep) / depth];
  }

  function groundAt([x, y]: MapPoint): MapPoint {
    const u = (x - sx) / focal, v = (y - sy) / focal;
    const along = v * distance / (flat + v * steep);
    const across = u * (distance - along * steep);
    return [cx + across * c - along * s, cy + across * s + along * c];
  }

  return { project, groundAt };
}

type CameraMotion = { heading?: number; tilt?: number; scale?: number };

export function moveMapCamera(view: MapCamera, motion: CameraMotion, from = MAP_CENTER, to = from): MapCamera {
  const next: MapCamera = {
    ...view,
    heading: ((view.heading + (motion.heading ?? 0)) % 360 + 540) % 360 - 180,
    tilt: clamp(view.tilt + (motion.tilt ?? 0), 0, 62),
    zoom: clamp(view.zoom * (motion.scale ?? 1), 1, MAX_MAP_ZOOM),
  };
  if (next.heading === view.heading && next.tilt === view.tilt && next.zoom === view.zoom &&
      from[0] === to[0] && from[1] === to[1]) return view;
  const [x, y] = mapLens(view).groundAt(from);
  const [u, v] = mapLens(next).groundAt(to);
  return {
    ...next,
    center: [clamp(next.center[0] + x - u, 166, 803), clamp(next.center[1] + y - v, 140, 441)],
  };
}

type PathToken = string | MapPoint;

export function compileMapPath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  let previous = 0;
  for (const match of path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
    tokens.push(path.slice(previous, match.index), [Number(match[1]), Number(match[2])]);
    previous = match.index + match[0].length;
  }
  tokens.push(path.slice(previous));
  return tokens;
}

const pointText = ([x, y]: MapPoint) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function renderMapPath(path: readonly PathToken[], project: ReturnType<typeof mapLens>["project"]) {
  let result = "";
  for (const token of path) result += typeof token === "string" ? token : pointText(project(token));
  return result;
}

export function renderMapArc(from: MapPoint, to: MapPoint, project: ReturnType<typeof mapLens>["project"]) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const lift = Math.min(126, 16 + Math.hypot(dx, dy) * .22);
  let result = `M${pointText(project(from))}`;
  // Sampling a lifted world-space arc keeps it attached to both cities when
  // the camera turns, and reveals its ground track in the overhead view.
  for (let i = 1; i < 24; i++) {
    const t = i / 24;
    result += `L${pointText(project([from[0] + dx * t, from[1] + dy * t], Math.sin(Math.PI * t) * lift))}`;
  }
  return result + `L${pointText(project(to))}`;
}
