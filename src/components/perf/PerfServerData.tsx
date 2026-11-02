import { getAccess } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { PERF_READY_EVENT, PERF_SCRIPT_ID } from "@/lib/perf/config";
import { perfCollector } from "@/lib/perf/request";

// Last child of the dashboard layout, inside Suspense. Renders only when the
// flag is on, the proxy marked the request (?perf=1) and the viewer is an
// admin; otherwise it returns null, so the HTML carries no timeline.
// It waits for the request's pending calls (capped) so the timeline is
// complete, then writes it as JSON and tells the client to open the panel.
export default async function PerfServerData() {
  const collector = await perfCollector();
  if (!collector) return null;
  if (!can(await getAccess(), "admin")) {
    collector.disable();
    return null;
  }
  const settled = await collector.whenIdle();
  const json = JSON.stringify(collector.snapshot(!settled)).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/json" id={PERF_SCRIPT_ID} dangerouslySetInnerHTML={{ __html: json }} />
      <script dangerouslySetInnerHTML={{ __html: `document.dispatchEvent(new Event("${PERF_READY_EVENT}"))` }} />
    </>
  );
}
