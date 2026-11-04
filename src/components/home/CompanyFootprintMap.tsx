"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import SelectMenu from "@/components/SelectMenu";
import { cityArcs, projectFootprintPath, projectFootprintPoint, type CompanyFootprintCity, type MapPerspective } from "@/lib/home/company-map";
import { US_OUTLINE, US_STATE_LINES, US_STATE_OUTLINES } from "@/lib/home/us-map-data";
import styles from "./CompanyFootprint.module.css";

const WIDTH = 804, HEIGHT = 310, CX = 436, CY = 235;
const INITIAL = { x: 0, y: 0, zoom: 1 };
const PAN_KEYS: Partial<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, 28], ArrowDown: [0, -28], ArrowLeft: [28, 0], ArrowRight: [-28, 0],
};
const PERSPECTIVES: { value: MapPerspective; label: string }[] = [
  { value: "angled", label: "Perspective" },
  { value: "overhead", label: "Overhead" },
  { value: "reverse", label: "Opposite angle" },
];
const button = "inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-ink hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-700 disabled:opacity-40";

type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
const center = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function move(camera: Camera, ratio: number, before: Point, after = before): Camera {
  const zoom = clamp(camera.zoom * ratio, 1, 4);
  const scale = zoom / camera.zoom;
  const limit = .18 + (zoom - 1) / 2;
  return {
    zoom,
    x: clamp(after.x - CX - scale * (before.x - CX - camera.x), -WIDTH * limit, WIDTH * limit),
    y: clamp(after.y - CY - scale * (before.y - CY - camera.y), -HEIGHT * limit, HEIGHT * limit),
  };
}

function localPoint(svg: SVGSVGElement, x: number, y: number) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: CX, y: CY };
  return new DOMPoint(x, y).matrixTransform(matrix.inverse());
}

export default function CompanyFootprintMap({ cities }: { cities: CompanyFootprintCity[] }) {
  const [camera, setCamera] = useState(INITIAL);
  const [perspective, setPerspective] = useState<MapPerspective>("angled");
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const dragged = useRef(false);
  const id = useId();
  const city = cities.find(({ label }) => label === selected);
  if (selected && !city) setSelected(null);
  const { outline, borders, states, markers, paths, labels } = useMemo(() => {
    const states = [...new Set(cities.map(({ label }) => label.slice(-2)))];
    const markers = cities.map((city) => ({ ...city, point: projectFootprintPoint(...city.point, perspective) }));
    const labels: typeof markers = [];
    for (const marker of markers) {
      if (labels.length < 9 && labels.every(({ point }) =>
        Math.abs(point[0] - marker.point[0]) > 76 || Math.abs(point[1] - marker.point[1]) > 20)) labels.push(marker);
    }
    return {
      outline: projectFootprintPath(US_OUTLINE, perspective),
      borders: projectFootprintPath(US_STATE_LINES, perspective),
      states: states.flatMap((state) => US_STATE_OUTLINES[state] ? [{ state, path: projectFootprintPath(US_STATE_OUTLINES[state], perspective) }] : []),
      markers, paths: cityArcs(cities, perspective), labels,
    };
  }, [cities, perspective]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== svg || !event.deltaY || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const anchor = localPoint(svg, event.clientX, event.clientY);
      setCamera((view) => move(view, event.deltaY < 0 ? 1.13 : 1 / 1.13, anchor));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    if (!pointers.current.size) dragged.current = false;
    const target = event.target;
    if (target instanceof Element) target.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event.currentTarget, event.clientX, event.clientY));
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = localPoint(event.currentTarget, event.clientX, event.clientY);
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    if (!other && !dragged.current && distance(previous, next) < 6) return;
    dragged.current = true;
    pointers.current.set(event.pointerId, next);
    setCamera((view) => other
      ? move(view, distance(other, next) / Math.max(1, distance(other, previous)), center(other, previous), center(other, next))
      : move(view, 1, previous, next));
  }

  function reset() {
    setCamera(INITIAL);
    setPerspective("angled");
  }

  function onMapKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const pan = PAN_KEYS[event.key];
    if (pan) setCamera((view) => move(view, 1, { x: 0, y: 0 }, { x: pan[0], y: pan[1] }));
    else if (event.key === "+" || event.key === "=") zoom(1.3);
    else if (event.key === "-") zoom(1 / 1.3);
    else if (event.key === "Home") reset();
    else return;
    event.preventDefault();
  }

  function zoom(ratio: number) {
    setCamera((view) => move(view, ratio, { x: CX, y: CY }));
  }

  return (
    <div className="min-w-0 w-full max-w-[760px] justify-self-center sm:-mt-5">
      <svg
        ref={svgRef}
        role="group"
        aria-label="Interactive map of companies in the United States"
        aria-describedby={`${id}-help`}
        tabIndex={0}
        viewBox="34 80 804 310"
        className="block h-auto w-full touch-none select-none rounded-xl cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-cyan-700"
        onKeyDown={onMapKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
      >
        <defs>
          <linearGradient id={`${id}-arc`} x1="0%" x2="100%" y1="100%" y2="0%">
            <stop stopColor="#48b9ca" /><stop offset=".55" stopColor="#009eb7" /><stop offset="1" stopColor="#54bfce" />
          </linearGradient>
        </defs>
        <rect x="34" y="80" width={WIDTH} height={HEIGHT} fill="transparent" />
        <g data-map-camera="" transform={`translate(${CX + camera.x} ${CY + camera.y}) scale(${camera.zoom}) translate(${-CX} ${-CY})`}>
          <g aria-hidden="true" className={styles.land}>
            <path d={outline} fill="white" stroke="#e1e6e8" strokeWidth="1.1" />
            <path d={borders} fill="none" stroke="#e1e6e8" strokeWidth=".85" />
            <g fill="none" stroke="#a8c4cb" strokeWidth="1.15" strokeLinejoin="round">
              {states.map(({ state, path }) => <path key={state} d={path} />)}
            </g>
          </g>
          <g aria-hidden="true" fill="none" stroke={`url(#${id}-arc)`} strokeLinecap="round">
            {paths.map(({ key, path }) => (
              <path key={key} d={path} pathLength={1} strokeWidth="1.5" opacity=".84" className={styles.arc} />
            ))}
          </g>
          <g className={styles.markers}>
            {markers.map(({ label, point: [x, y], count }) => (
              <g key={label} role="button" tabIndex={0}
                aria-label={`${label}, ${count} ${count === 1 ? "company" : "companies"}`}
                aria-pressed={selected === label}
                className={styles.city}
                onClick={() => { if (!dragged.current) setSelected(label); }}
                onFocus={(event) => {
                  // Keyboard focus on an offscreen point brings it into view.
                  if (!event.currentTarget.matches(":focus-visible")) return;
                  setCamera((view) => {
                    const position = { x: CX + view.x + (x - CX) * view.zoom, y: CY + view.y + (y - CY) * view.zoom };
                    if (Math.abs(position.x - CX) < WIDTH / 2 - 20 && Math.abs(position.y - CY) < HEIGHT / 2 - 20) return view;
                    return move(view, 1, position, { x: CX, y: CY });
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelected(label);
                }}
              >
                <title>{`${label} · ${count}`}</title>
                <circle cx={x} cy={y} r={24 / Math.sqrt(camera.zoom)} fill="transparent" />
                <circle className={styles.cityHalo} cx={x} cy={y} r={Math.min(8, 4.2 + Math.sqrt(count) * .65)}
                  fill="#a6e8ee" opacity=".56" />
                <circle cx={x} cy={y} r={selected === label ? 4.6 : 3} fill="#007e96" stroke="#fff" strokeWidth="1" />
              </g>
            ))}
            {labels.map(({ label, point: [x, y] }) => <text aria-hidden="true" key={label} x={x} y={y + 15}
              textAnchor="middle" fill="#3b616b" stroke="#fff" strokeWidth="3.5" strokeLinejoin="round" paintOrder="stroke"
              fontSize="11.5" fontWeight="600" className="pointer-events-none hidden md:block">{label.split(",")[0]}</text>)}
          </g>
        </g>
      </svg>
      <div className="flex flex-wrap items-center justify-end gap-1.5" aria-label="Map controls" role="group">
        <button type="button" className={button} aria-label="Zoom out" disabled={camera.zoom === 1} onClick={() => zoom(1 / 1.3)}>−</button>
        <button type="button" className={button} aria-label="Zoom in" disabled={camera.zoom === 4} onClick={() => zoom(1.3)}>+</button>
        <SelectMenu ariaLabel="Map perspective" options={PERSPECTIVES} value={perspective}
          buttonClassName="min-h-9 gap-2"
          onChange={(value) => {
            const option = PERSPECTIVES.find((item) => item.value === value);
            if (option) {
              setPerspective(option.value);
              setCamera(INITIAL);
            }
          }} />
        <button type="button" className={button} onClick={reset}>Reset view</button>
      </div>
      <p id={`${id}-help`} className="mt-2 text-right text-[11px] text-neutral-500">
        Drag to move · Pinch or use +/− to zoom · Select a city
        <span className="sr-only">. With the map focused, use arrow keys to move, plus and minus to zoom, or Home to reset.</span>
      </p>
      <div aria-live="polite">
        {city && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-cyan-100 px-3 py-2 text-xs">
          <span className="font-semibold text-ink">{city.label}</span>
          <span className="text-neutral-600">{city.count} {city.count === 1 ? "company" : "companies"}</span>
          <Link href={city.href} prefetch={false} className="ml-auto font-semibold text-cyan-800 hover:underline">View companies</Link>
          <button type="button" className={button} aria-label="Clear selected city"
            onClick={() => { setSelected(null); svgRef.current?.focus(); }}>Clear</button>
        </div>}
      </div>
    </div>
  );
}
