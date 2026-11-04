import { sidebarCookieName } from "../ui/entrance";

const suffix = (email: string, name: string) => sidebarCookieName(email).replace("vq_sidebar_", `vq_${name}_`);

export const notificationCookieName = (email: string) => suffix(email, "notices");
export const landingCookieName = (email: string) => suffix(email, "landing");
export const pipelineCookieName = (email: string) => suffix(email, "pipeline");

export type NoticeCategory = "tasks" | "mentions" | "chat" | "drafts";
export const NOTICE_FLAGS: Record<NoticeCategory, number> = { tasks: 1, mentions: 2, chat: 4, drafts: 8 };

export function noticeMask(value: string | undefined): number {
  if (!value || !/^(?:[0-9]|1[0-5])$/.test(value)) return 15;
  return Number(value);
}

export function notificationKinds(mask: number): string[] {
  return [
    ...(mask & NOTICE_FLAGS.tasks ? ["task_assigned", "contact_reminder"] : []),
    ...(mask & NOTICE_FLAGS.mentions ? ["chat_mention", "comment_mention", "comment_reply", "contact_note_tag"] : []),
    ...(mask & NOTICE_FLAGS.chat ? ["chat_direct", "chat_group"] : []),
    ...(mask & NOTICE_FLAGS.drafts ? ["draft_assigned"] : []),
  ];
}

// The saved value keeps the route names of earlier versions, so every cookie
// saved so far (and a rollback) keeps working: "/overview" now means the
// Dashboard tab of Home. `landingDestination` is where it actually goes.
export type LandingPage = "/home" | "/overview" | "/pipeline";
export function landingPage(value: string | undefined): LandingPage {
  return value === "/overview" || value === "/pipeline" ? value : "/home";
}
export function landingDestination(page: LandingPage): string {
  return page === "/overview" ? "/home?tab=dashboard" : page;
}
export type PipelineDefault = "all" | "active";
export function pipelineDefault(value: string | undefined): PipelineDefault {
  return value === "active" ? "active" : "all";
}
