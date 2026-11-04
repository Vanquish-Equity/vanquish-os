"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import SelectMenu from "@/components/SelectMenu";
import { cityArcs, projectFootprintPath, projectFootprintPoint, type CompanyFootprintCity, type MapPerspective } from "@/lib/home/company-map";
import { US_OUTLINE, US_STATE_LINES, US_STATE_OUTLINES } from "@/lib/home/us-map-data";
import styles from "./CompanyFootprint.module.css";

const LEFT = 34, TOP = 80, WIDTH = 804, HEIGHT = 310;
const CX = LEFT + WIDTH / 2, CY = TOP + HEIGHT / 2;
const INITIAL = { x: 0, y: 0, zoom: 1 };
const PAN_KEYS: Partial<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, 28], ArrowDown: [0, -28], ArrowLeft: [28, 0], ArrowRight: [-28, 0],
};
const PERSPECTIVES: { value: MapPerspective; label: string }[] = [
  { value: "angled", label: "Perspective" },
  { value: "overhead", label: "Overhead" },
  { value: "reverse", label: "Opposite angle" },
];
const control = "inline-flex min-h-8 min-w-8 items-center justify-center px-2 text-xs font-semibold text-neutral-600 hover:bg-cyan-50 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-700 disabled:opacity-35";

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

function localPoint(stage: HTMLDivElement, x: number, y: number): Point {
  const bounds = stage.getBoundingClientRect();
  return {
    x: LEFT + (x - bounds.left) * WIDTH / bounds.width,
    y: TOP + (y - bounds.top) * HEIGHT / bounds.height,
  };
}

function viewportPosition([x, y]: readonly [number, number], camera: Camera) {
  return {
    x: 50 + 100 * (camera.x + (x - CX) * camera.zoom) / WIDTH,
    y: 50 + 100 * (camera.y + (y - CY) * camera.zoom) / HEIGHT,
  };
}

export default function CompanyFootprintMap({ cities }: { cities: CompanyFootprintCity[] }) {
  const [camera, setCamera] = useState(INITIAL);
  const [perspective, setPerspective] = useState<MapPerspective>("angled");
  const [selected, setSelected] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const dragged = useRef(false);
  const id = useId();
  const city = cities.find(({ label }) => label === selected);
  if (selected && !city) setSelected(null);
  const { outline, borders, states, markers, paths } = useMemo(() => {
    const states = [...new Set(cities.map(({ label }) => label.slice(-2)))];
    const markers = cities.map((city) => ({ ...city, point: projectFootprintPoint(...city.point, perspective) }));
    return {
      outline: projectFootprintPath(US_OUTLINE, perspective),
      borders: projectFootprintPath(US_STATE_LINES, perspective),
      states: states.flatMap((state) => US_STATE_OUTLINES[state] ? [{ state, path: projectFootprintPath(US_STATE_OUTLINES[state], perspective) }] : []),
      markers, paths: cityArcs(cities, perspective),
    };
  }, [cities, perspective]);

  // The camera moves geography. Marker targets and labels stay in page pixels.
  const positioned = markers.map((marker) => ({ ...marker, screen: viewportPosition(marker.point, camera) }));
  const visible = positioned.filter(({ screen: { x, y } }) => x > 1.5 && x < 98.5 && y > 3 && y < 97);
  const activeMarker = visible.find(({ label }) => label === city?.label);
  const labels: typeof visible = [];
  for (const marker of visible) {
    if (labels.every(({ screen }) => Math.abs(screen.x - marker.screen.x) > 12 || Math.abs(screen.y - marker.screen.y) > 8)) {
      labels.push(marker);
    }
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== stage || !event.deltaY || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const anchor = localPoint(stage, event.clientX, event.clientY);
      setCamera((view) => move(view, event.deltaY < 0 ? 1.13 : 1 / 1.13, anchor));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2 || (event.target instanceof Element && event.target.closest("[data-city-popup]"))) return;
    if (!pointers.current.size) dragged.current = false;
    const target = event.target;
    if (target instanceof Element) target.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event.currentTarget, event.clientX, event.clientY));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
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
    setSelected(null);
  }

  function onMapKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      closeCity();
      return;
    }
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

  function closeCity() {
    setSelected(null);
    const stage = stageRef.current;
    const marker = stage?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
    (marker ?? stage)?.focus({ preventScroll: true });
  }

  return (
    <div className="relative min-w-0 w-full">
      <div className="relative z-20 flex flex-wrap items-center justify-end gap-1.5" aria-label="Map controls" role="group">
        <SelectMenu ariaLabel="Map perspective" options={PERSPECTIVES} value={perspective}
          buttonClassName="min-h-8 gap-2 py-1 text-xs"
          onChange={(value) => {
            const option = PERSPECTIVES.find((item) => item.value === value);
            if (option) {
              setPerspective(option.value);
              setCamera(INITIAL);
            }
          }} />
        <div className="flex rounded-full border border-neutral-200 bg-white">
          <button type="button" className={`${control} rounded-l-full`} aria-label="Zoom out" disabled={camera.zoom === 1} onClick={() => zoom(1 / 1.3)}>−</button>
          <button type="button" className={`${control} rounded-r-full border-l border-neutral-200`} aria-label="Zoom in" disabled={camera.zoom === 4} onClick={() => zoom(1.3)}>+</button>
        </div>
        <button type="button" className={`${control} rounded-full`} onClick={reset}>Reset view</button>
      </div>

      <div
        ref={stageRef}
        role="group"
        aria-label="Interactive map of companies in the United States"
        aria-describedby={`${id}-help`}
        tabIndex={0}
        className="relative isolate aspect-[804/310] w-full touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-cyan-700"
        onKeyDown={onMapKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
        onClick={(event) => {
          if (!dragged.current && !(event.target instanceof Element && event.target.closest("button, [data-city-popup]"))) {
            setSelected(null);
          }
        }}
      >
        <svg aria-hidden="true" viewBox={`${LEFT} ${TOP} ${WIDTH} ${HEIGHT}`}
          className={`${styles.geography} pointer-events-none absolute inset-0 block size-full overflow-hidden`}
          data-exploring={camera.zoom > 1 || camera.x !== 0 || camera.y !== 0}>
          <defs>
            <linearGradient id={`${id}-arc`} x1="0%" x2="100%" y1="100%" y2="0%">
              <stop stopColor="#48b9ca" /><stop offset=".55" stopColor="#009eb7" /><stop offset="1" stopColor="#54bfce" />
            </linearGradient>
          </defs>
          <g data-map-camera="" transform={`translate(${CX + camera.x} ${CY + camera.y}) scale(${camera.zoom}) translate(${-CX} ${-CY})`}>
            <g className={styles.land}>
              <path d={outline} fill="white" stroke="#e1e6e8" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
              <path d={borders} fill="none" stroke="#e1e6e8" strokeWidth=".85" vectorEffect="non-scaling-stroke" />
              <g fill="none" stroke="#a8c4cb" strokeWidth="1.15" strokeLinejoin="round">
                {states.map(({ state, path }) => <path key={state} d={path} vectorEffect="non-scaling-stroke" />)}
              </g>
            </g>
            <g fill="none" stroke={`url(#${id}-arc)`} strokeLinecap="round">
              {paths.map(({ key, path }) => (
                <path key={key} d={path} pathLength={1} strokeWidth="1.35" opacity=".84" vectorEffect="non-scaling-stroke" className={styles.arc} />
              ))}
            </g>
          </g>
        </svg>

        <div className={`${styles.markers} pointer-events-none absolute inset-0 overflow-hidden`}>
          {visible.map(({ label, screen, count }) => (
            <button key={label} type="button"
              aria-label={`${label}, ${count} ${count === 1 ? "company" : "companies"}`}
              aria-expanded={selected === label}
              aria-controls={selected === label ? `${id}-city` : undefined}
              title={label}
              className={`${styles.city} ${selected === label ? "z-10" : ""}`}
              style={{ left: `${screen.x}%`, top: `${screen.y}%` }}
              onClick={(event) => {
                if (event.detail !== 0 && dragged.current) return;
                setSelected((current) => current === label ? null : label);
                if (event.detail === 0 && selected !== label) {
                  requestAnimationFrame(() => document.getElementById(`${id}-city`)?.querySelector("a")?.focus());
                }
              }}
            >
              <span className={styles.cityDot} />
              {labels.some((item) => item.label === label) && selected !== label && (
                <span aria-hidden="true" className={`${styles.cityLabel} ${camera.zoom < 1.5 ? "hidden md:block" : ""}`}
                  data-align={screen.x > 85 ? "end" : screen.x < 15 ? "start" : undefined}>
                  {label.split(",")[0]}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeMarker && (
          <div data-city-popup="" id={`${id}-city`} className={styles.cityPopup}
            style={{ "--marker-x": `${activeMarker.screen.x}%`, "--marker-y": `${activeMarker.screen.y}%` } as CSSProperties}
            data-side={activeMarker.screen.y < 57 ? "below" : "above"}
            data-edge={activeMarker.screen.x > 50 ? "right" : "left"}>
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink">{activeMarker.label}</div>
                <div className="mt-0.5 text-[11px] text-neutral-600" aria-live="polite">
                  {activeMarker.count} {activeMarker.count === 1 ? "company" : "companies"}
                </div>
              </div>
              <button type="button" className={`${control} -mr-1 -mt-1 shrink-0 rounded-full`} aria-label="Clear selected city" onClick={closeCity}>×</button>
            </div>
            <Link href={activeMarker.href} prefetch={false}
              className="mt-2 inline-block rounded-sm text-[11px] font-semibold text-cyan-800 hover:underline focus-visible:outline-2 focus-visible:outline-cyan-700">View companies</Link>
          </div>
        )}
      </div>
      <p id={`${id}-help`} className="sr-only">
        Drag to move, pinch or use the zoom controls, or select a city. With the map focused, use the mouse wheel or plus and minus to zoom, arrows to move, or Home to reset.
      </p>
    </div>
  );
}
