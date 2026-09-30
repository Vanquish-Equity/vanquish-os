import type { ComposeSeed } from "./MailComposer";
export const button =
  "rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-40";
export const empty: ComposeSeed = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
};
export function sender(from: string) {
  return from.replace(/<.*>/, "").replace(/^"|"$/g, "").trim() || from;
}
export function dateLabel(value: string) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
}
