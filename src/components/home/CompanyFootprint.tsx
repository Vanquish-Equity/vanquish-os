import Link from "next/link";
import { cityArcs, groupCompanyCities, MAP_COMPANY_LIMIT, projectFootprintPoint, projectFootprintPath } from "@/lib/home/company-map";
import { US_OUTLINE, US_STATE_LINES, US_STATE_OUTLINES } from "@/lib/home/us-map-data";
import styles from "./CompanyFootprint.module.css";

const outline = projectFootprintPath(US_OUTLINE);
const borders = projectFootprintPath(US_STATE_LINES);
const stateOutlines = Object.fromEntries(
  Object.entries(US_STATE_OUTLINES).map(([state, path]) => [state, projectFootprintPath(path)]),
);

export default function CompanyFootprint({ rows, partial }: {
  rows: { location: string | null }[] | null;
  partial: boolean;
}) {
  const cities = groupCompanyCities(rows ?? []);
  const markers = cities.map((city) => ({ ...city, point: projectFootprintPoint(...city.point) }));
  const count = cities.reduce((total, city) => total + city.count, 0);
  const states = [...new Set(cities.map(({ label }) => label.slice(-2)))];
  const paths = cityArcs(cities);
  const labels: typeof markers = [];
  for (const marker of markers) {
    if (labels.length < 9 && labels.every(({ point }) =>
      Math.abs(point[0] - marker.point[0]) > 76 || Math.abs(point[1] - marker.point[1]) > 20)) labels.push(marker);
  }
  const unmapped = (rows?.length ?? 0) - count;
  return (
    <section aria-labelledby="company-footprint" className="min-w-0">
      <div className="grid min-w-0 items-start gap-2 sm:grid-cols-[minmax(10.5rem,1fr)_minmax(0,3fr)] sm:gap-6">
        <div className="min-w-0 sm:pt-[clamp(1.25rem,5vw,4rem)]">
          <h2 id="company-footprint" className="text-xs font-semibold uppercase tracking-[.13em] text-cyan-800">Company footprint</h2>
          {count > 0 ? <p className="mt-1.5 text-sm text-neutral-600">
            {count} {count === 1 ? "company" : "companies"} across {cities.length} {cities.length === 1 ? "US city" : "US cities"}
          </p> : <p className="mt-1.5 text-sm text-neutral-600">
            {rows === null ? "Company locations are unavailable right now." : "Add a supported US city in Companies to place it on the map."}
          </p>}
          {(unmapped > 0 || partial) && <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            {unmapped > 0 && <span>{unmapped} {unmapped === 1 ? "location" : "locations"} outside the map. </span>}
            {partial && <span>Based on the first {MAP_COMPANY_LIMIT} records.</span>}
          </p>}
          {cities.length > 0 && <details className="mt-2.5">
            <summary className="vq-disclosure text-xs text-cyan-800">
              Explore cities
            </summary>
            <p className="mb-2 mt-2 text-xs text-neutral-500">Arcs illustrate geographic coverage.</p>
            <ul aria-label="Companies by city" className="flex max-h-40 flex-wrap gap-x-2 gap-y-1.5 overflow-y-auto p-1">
              {cities.map(({ label, count, locations }) => (
                <li key={label}>
                  <Link href={`/companies?${new URLSearchParams({ "match-location": JSON.stringify(locations.slice(0, 50)) })}`}
                    prefetch={false} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan-100 px-3 text-xs text-cyan-900 visited:text-cyan-900 hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-600">
                    {label}<span className="tabular-nums text-cyan-800">{count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>}
        </div>
        <svg aria-hidden="true" viewBox="34 80 804 310"
          className="block h-auto w-full max-w-[760px] justify-self-center sm:-mt-5">
          <defs>
            <linearGradient id="footprint-arc" x1="0%" x2="100%" y1="100%" y2="0%">
              <stop stopColor="#48b9ca" /><stop offset=".55" stopColor="#009eb7" /><stop offset="1" stopColor="#54bfce" />
            </linearGradient>
          </defs>
          <g className={styles.land}>
            <path d={outline} fill="white" stroke="#e1e6e8" strokeWidth="1.1" />
            <path d={borders} fill="none" stroke="#e1e6e8" strokeWidth=".85" />
            <g fill="none" stroke="#a8c4cb" strokeWidth="1.15" strokeLinejoin="round">
              {states.map((state) => <path key={state} d={stateOutlines[state]} />)}
            </g>
          </g>
          <g fill="none" stroke="url(#footprint-arc)" strokeLinecap="round">
            {paths.map(({ key, path }) => (
              <path key={key} d={path} pathLength={1} strokeWidth="1.5" opacity=".84" className={styles.arc} />
            ))}
          </g>
          <g className={styles.markers}>
            {markers.map(({ label, point: [x, y], count }) => <g key={label}>
              <circle cx={x} cy={y} r={Math.min(8, 4.2 + Math.sqrt(count) * .65)} fill="#a6e8ee" opacity=".56" />
              <circle cx={x} cy={y} r="3" fill="#007e96" stroke="#fff" strokeWidth="1" />
            </g>)}
            {labels.map(({ label, point: [x, y] }) => <text key={label} x={x} y={y + 15} textAnchor="middle"
              fill="#3b616b" stroke="#fff" strokeWidth="3.5" strokeLinejoin="round" paintOrder="stroke"
              fontSize="11.5" fontWeight="600" className="hidden md:block">{label.split(",")[0]}</text>)}
          </g>
        </svg>
      </div>
    </section>
  );
}
