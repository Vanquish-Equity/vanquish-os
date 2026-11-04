"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cityArcs, type CompanyFootprintCity } from "@/lib/home/company-map";
import {
  compileMapPath, DEFAULT_MAP_CAMERA, MAP_VIEW, mapLens, moveMapCamera,
  renderMapArc, renderMapPath, type MapPoint,
} from "@/lib/home/map-camera";
import { US_OUTLINE, US_STATE_LINES, US_STATE_OUTLINES } from "@/lib/home/us-map-data";
import styles from "./CompanyFootprint.module.css";

const { left: LEFT, top: TOP, width: WIDTH, height: HEIGHT } = MAP_VIEW;
const ORBIT_KEYS: Partial<Record<string, { heading?: number; tilt?: number }>> = {
  ArrowUp: { tilt: -7 }, ArrowDown: { tilt: 7 }, ArrowLeft: { heading: 14 }, ArrowRight: { heading: -14 },
};
const control = "inline-flex min-h-8 min-w-8 items-center justify-center px-2 text-xs font-semibold text-neutral-600 hover:bg-cyan-50 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-700 disabled:opacity-35";
const outline = compileMapPath(US_OUTLINE);
const borders = compileMapPath(US_STATE_LINES);

const center = ([x, y]: MapPoint, [u, v]: MapPoint): MapPoint => [(x + u) / 2, (y + v) / 2];
const distance = ([x, y]: MapPoint, [u, v]: MapPoint) => Math.hypot(x - u, y - v);
const bearing = ([x, y]: MapPoint, [u, v]: MapPoint) => Math.atan2(v - y, u - x) * 180 / Math.PI;

function localPoint(stage: HTMLDivElement, x: number, y: number): MapPoint {
  const bounds = stage.getBoundingClientRect();
  return [
    LEFT + (x - bounds.left) * WIDTH / bounds.width,
    TOP + (y - bounds.top) * HEIGHT / bounds.height,
  ];
}

function viewportPosition([x, y]: MapPoint) {
  return { x: 100 * (x - LEFT) / WIDTH, y: 100 * (y - TOP) / HEIGHT };
}

export default function CompanyFootprintMap({ cities }: { cities: CompanyFootprintCity[] }) {
  const [camera, setCamera] = useState(DEFAULT_MAP_CAMERA);
  const [pointerFocus, setPointerFocus] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, MapPoint>());
  const dragged = useRef(false);
  const id = useId();
  const city = cities.find(({ label }) => label === selected);
  if (selected && !city) setSelected(null);
  const { states, arcs } = useMemo(() => ({
    states: [...new Set(cities.map(({ label }) => label.slice(-2)))].flatMap((state) =>
      US_STATE_OUTLINES[state] ? [{ state, path: compileMapPath(US_STATE_OUTLINES[state]) }] : []),
    arcs: cityArcs(cities),
  }), [cities]);
  const { landPath, borderPath, statePaths, arcPaths, positioned } = useMemo(() => {
    const { project } = mapLens(camera);
    return {
      landPath: renderMapPath(outline, project),
      borderPath: renderMapPath(borders, project),
      statePaths: states.map(({ state, path }) => ({ state, path: renderMapPath(path, project) })),
      arcPaths: arcs.map(({ key, from, to }) => ({ key, path: renderMapArc(from, to, project) })),
      // Only the world geometry is projected; labels and hit targets stay upright.
      positioned: cities.map((marker) => ({ ...marker, screen: viewportPosition(project(marker.point)) })),
    };
  }, [arcs, camera, cities, states]);
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
      setCamera((view) => moveMapCamera(view, { scale: event.deltaY < 0 ? 1.13 : 1 / 1.13 }, anchor));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.button !== 0 && event.button !== 2) || pointers.current.size >= 2 ||
        (event.target instanceof Element && event.target.closest("[data-city-popup]"))) return;
    if (!pointers.current.size) dragged.current = false;
    const stage = event.currentTarget;
    if (event.button === 2) event.preventDefault();
    pointers.current.set(event.pointerId, localPoint(stage, event.clientX, event.clientY));
    if (event.target === stage || event.button === 2) {
      // Right-click can inherit keyboard focus visibility from the browser.
      setPointerFocus(true);
      stage.focus({ preventScroll: true });
    }
    if (pointers.current.size === 2) {
      dragged.current = true;
      for (const id of pointers.current.keys()) stage.setPointerCapture(id);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const stage = event.currentTarget;
    const next = localPoint(stage, event.clientX, event.clientY);
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    if (!other && !dragged.current && distance(previous, next) < 4) return;
    dragged.current = true;
    if (!stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, next);
    if (other) {
      const gap = distance(other, previous), nextGap = distance(other, next);
      if (gap > 6 && nextGap > 6) {
        setCamera((view) => moveMapCamera(view, {
          scale: nextGap / gap,
          heading: bearing(other, previous) - bearing(other, next),
        }, center(other, previous)));
      }
    } else {
      setCamera((view) => moveMapCamera(view, {
        heading: (previous[0] - next[0]) * .38,
        tilt: (next[1] - previous[1]) * .28,
      }));
    }
  }

  function reset() {
    setCamera(DEFAULT_MAP_CAMERA);
    setSelected(null);
  }

  function onMapKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      closeCity();
      return;
    }
    if (event.target !== event.currentTarget) return;
    setPointerFocus(false);
    const orbit = ORBIT_KEYS[event.key];
    if (orbit) setCamera((view) => moveMapCamera(view, orbit));
    else if (event.key === "+" || event.key === "=" || event.key === "-") {
      setCamera((view) => moveMapCamera(view, { scale: event.key === "-" ? 1 / 1.3 : 1.3 }));
    } else if (event.key === "Home") reset();
    else return;
    event.preventDefault();
  }

  function closeCity() {
    setSelected(null);
    const stage = stageRef.current;
    const marker = stage?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
    (marker ?? stage)?.focus({ preventScroll: true });
  }

  return (
    <div className="relative min-w-0 w-full">
      <div
        ref={stageRef}
        data-context-exclude=""
        role="group"
        aria-label="Interactive map of companies in the United States"
        aria-describedby={`${id}-help`}
        tabIndex={0}
        className={`relative isolate aspect-[804/310] w-full touch-none select-none cursor-grab active:cursor-grabbing ${pointerFocus ? "outline-none" : "focus-visible:outline-2 focus-visible:outline-cyan-700"}`}
        onBlur={(event) => { if (event.target === event.currentTarget) setPointerFocus(false); }}
        onKeyDown={onMapKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) pointers.current.delete(event.pointerId);
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) pointers.current.delete(event.pointerId);
        }}
        onContextMenu={(event) => {
          if (!(event.target instanceof Element && event.target.closest("[data-city-popup]"))) event.preventDefault();
        }}
        onClick={(event) => {
          if (!dragged.current && !(event.target instanceof Element && event.target.closest("button, [data-city-popup]"))) {
            setSelected(null);
          }
        }}
      >
        <svg aria-hidden="true" viewBox={`${LEFT} ${TOP} ${WIDTH} ${HEIGHT}`}
          className={`${styles.geography} pointer-events-none absolute inset-0 block size-full overflow-hidden`}
          data-exploring={camera !== DEFAULT_MAP_CAMERA}>
          <defs>
            <linearGradient id={`${id}-arc`} x1="0%" x2="100%" y1="100%" y2="0%">
              <stop stopColor="#48b9ca" /><stop offset=".55" stopColor="#009eb7" /><stop offset="1" stopColor="#54bfce" />
            </linearGradient>
          </defs>
          <g data-map-camera="">
            <g className={styles.land}>
              <path d={landPath} fill="white" stroke="#e1e6e8" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
              <path d={borderPath} fill="none" stroke="#e1e6e8" strokeWidth=".85" vectorEffect="non-scaling-stroke" />
              <g fill="none" stroke="#a8c4cb" strokeWidth="1.15" strokeLinejoin="round">
                {statePaths.map(({ state, path }) => <path key={state} d={path} vectorEffect="non-scaling-stroke" />)}
              </g>
            </g>
            <g fill="none" stroke={`url(#${id}-arc)`} strokeLinecap="round">
              {arcPaths.map(({ key, path }) => (
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
        Drag to rotate and tilt. On touch, pinch to zoom or twist two fingers to rotate.
        With the map focused, use the arrow keys to rotate or tilt, the mouse wheel or plus and minus to zoom,
        and Home to reset.
      </p>
    </div>
  );
}
