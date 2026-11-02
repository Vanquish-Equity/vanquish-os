import { createRoot } from "react-dom/client";
import PerfPanel from "./PerfPanel";

let mounted = false;

/** Mounts the panel in its own React root, once. Called only when the server wrote the timeline. */
export function mountPerfPanel() {
  if (mounted) return;
  mounted = true;
  const host = document.createElement("div");
  host.setAttribute("data-vq-perf-host", "");
  document.body.appendChild(host);
  createRoot(host).render(<PerfPanel />);
}
